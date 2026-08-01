// POST /api/admin/clients/[id]/resume — « Résumer la situation » (IA),
// Mode Appel phase 5. Body optionnel : { force?: boolean }.
//
// Fraîcheur : si clients.resume_ia existe et resume_ia_genere_le est
// postérieur à la dernière activité connue (intervention, note d'appel,
// mail, facture) et !force → renvoie le cache SANS appel IA.
//
// Sinon : contexte texte compact (≤ ~8000 caractères, sections les plus
// anciennes tronquées d'abord) → runAgent 'resume_situation' (règle
// absolue doc 02 §10 : tout appel Anthropic passe par runAgent) →
// persistance dans clients.resume_ia / resume_ia_genere_le.
//
// Génération UNIQUEMENT à la demande (clic / force) — jamais automatique.

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from '@/lib/auth/server';
import { runAgent } from '@/lib/observability';
import { getClient360, type Client360 } from '@/app/admin/clients/[id]/client360';
import type { Client } from '@/lib/types/database';

export const dynamic = 'force-dynamic';
// Appel IA (5-10 s normales) + requêtes 360°.
export const maxDuration = 60;

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;
const MAX_CONTEXT_CHARS = 8000;

const SYSTEM = [
  "Tu rédiges un résumé de situation client pour une secrétaire FoxO au téléphone (recherche de fuites, Belgique).",
  'On te fournit un contexte factuel : situation mécanique, interventions, résumés de mails, notes d\'appel, journal d\'événements, factures en retard.',
  'Règles STRICTES :',
  '1) 4 à 8 phrases, factuel, ordre chronologique.',
  "2) Mentionne : où en est le dossier le plus récent, ce qui est attendu ou en attente, les impayés éventuels, et tout point de vigilance (occupant difficile à joindre, relances, urgence).",
  "3) N'invente RIEN : uniquement ce qui figure dans le contexte fourni. Si une information manque, ne la mentionne pas.",
  '4) Français clair et professionnel, phrases complètes.',
  '5) Sortie = texte brut uniquement — pas de markdown, pas de listes, pas de titres.',
].join('\n');

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('fr-BE', {
      day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Brussels',
    });
  } catch {
    return iso;
  }
}

function maxIso(...dates: (string | null | undefined)[]): string | null {
  let out: string | null = null;
  for (const d of dates) {
    if (d && (!out || new Date(d) > new Date(out))) out = d;
  }
  return out;
}

// ─── Contexte texte compact ─────────────────────────────────────────────

type NoteRow = { contenu: string; created_by: string | null; created_at: string };
type MailRow = { resume: string | null; classification: string | null; recu_le: string | null };
type TimelineRow = { type: string; message: string | null; created_at: string };

function buildContexte(args: {
  clientNom: string;
  c360: Client360;
  notes: NoteRow[];
  mails: MailRow[];
  timeline: TimelineRow[];
}): string {
  const { clientNom, c360, notes, mails, timeline } = args;

  // Caps par section, réduits itérativement (les listes sont triées récentes
  // d'abord : réduire = tronquer les entrées les plus anciennes d'abord).
  let capIv = 20;
  let capMails = 10;
  let capNotes = 10;
  let capTimeline = 30;

  const assemble = (): string => {
    const sections: string[] = [];
    sections.push(`CLIENT : ${clientNom}`);
    if (c360.resume) sections.push(`SITUATION (mécanique) : ${c360.resume}`);

    if (c360.interventions.length > 0) {
      sections.push(
        'INTERVENTIONS (récentes d\'abord) :\n' +
        c360.interventions.slice(0, capIv).map((iv) => {
          const rapport = iv.rapport?.statut === 'transmis'
            ? `rapport transmis le ${fmtDate(iv.rapport.transmis_at)}`
            : iv.rapport_historique_url
              ? 'rapport historique (Drive) disponible'
              : 'pas de rapport';
          const desc = iv.description;
          return `- ${iv.ref ?? iv.id.slice(0, 8)} · ${fmtDate(iv.date_effective)} · ${iv.statut} · ${iv.type ?? '—'} · ${rapport}${desc ? ` · ${desc.slice(0, 200)}` : ''}`;
        }).join('\n'),
      );
    }

    if (mails.length > 0) {
      sections.push(
        'RÉSUMÉS DE MAILS (récents d\'abord) :\n' +
        mails.slice(0, capMails).map((m) =>
          `- ${fmtDate(m.recu_le)}${m.classification ? ` [${m.classification}]` : ''} : ${(m.resume ?? '').slice(0, 300)}`,
        ).join('\n'),
      );
    }

    if (notes.length > 0) {
      sections.push(
        'NOTES D\'APPEL (récentes d\'abord) :\n' +
        notes.slice(0, capNotes).map((n) =>
          `- ${fmtDate(n.created_at)}${n.created_by ? ` (${n.created_by})` : ''} : ${n.contenu.slice(0, 300)}`,
        ).join('\n'),
      );
    }

    if (timeline.length > 0) {
      sections.push(
        'JOURNAL D\'ÉVÉNEMENTS (récents d\'abord) :\n' +
        timeline.slice(0, capTimeline).map((t) =>
          `- ${fmtDate(t.created_at)} · ${t.type}${t.message ? ` : ${t.message.slice(0, 150)}` : ''}`,
        ).join('\n'),
      );
    }

    const retard = c360.factures.filter((f) => f.en_retard);
    if (retard.length > 0) {
      sections.push(
        'FACTURES EN RETARD :\n' +
        retard.map((f) =>
          `- ${f.numero} · échéance ${fmtDate(f.date_echeance)} · ${f.jours_retard} j de retard · ${f.montant_ttc ?? '?'} € TTC`,
        ).join('\n'),
      );
    }

    return sections.join('\n\n');
  };

  // Plafond ~8000 caractères : on rogne les sections par le bas (les entrées
  // les plus anciennes) jusqu'à passer sous le cap.
  let out = assemble();
  while (out.length > MAX_CONTEXT_CHARS && (capIv > 3 || capMails > 2 || capNotes > 3 || capTimeline > 5)) {
    if (capTimeline > 5) capTimeline -= 5;
    else if (capMails > 2) capMails -= 2;
    else if (capIv > 3) capIv -= 3;
    else if (capNotes > 3) capNotes -= 2;
    out = assemble();
  }
  return out.slice(0, MAX_CONTEXT_CHARS + 500); // garde-fou final
}

// ─── Route ──────────────────────────────────────────────────────────────

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { force?: boolean } | null;
  const force = body?.force === true;

  const admin = createAdminClient();

  // Client : id direct, repli acp_id (même résolution que la page fiche).
  const byId = await admin.from('clients').select('*').eq('id', id).maybeSingle();
  const byAcp = byId.data
    ? null
    : await admin.from('clients').select('*').eq('acp_id', id).limit(1).maybeSingle();
  const clientRow = (byId.data ?? byAcp?.data ?? null) as
    | (Client & { resume_ia?: string | null; resume_ia_genere_le?: string | null })
    | null;
  if (!clientRow) {
    return NextResponse.json({ ok: false, error: 'Client introuvable.' }, { status: 404 });
  }

  // Données 360° (interventions, factures, occupants, dernier mail, résumé mécanique).
  const c360 = await getClient360({
    id: clientRow.id,
    acp_id: clientRow.acp_id ?? null,
    type: clientRow.type,
  });
  const ivIds = c360.interventions.map((iv) => iv.id);

  // Notes d'appel (fraîcheur + contexte).
  const { data: notesData } = await admin
    .from('notes_appel')
    .select('contenu, created_by, created_at')
    .eq('client_id', clientRow.id)
    .order('created_at', { ascending: false })
    .limit(10);
  const notes = (notesData ?? []) as NoteRow[];

  // FRAÎCHEUR — dernière activité connue.
  const lastActivity = maxIso(
    c360.interventions[0]?.created_at,
    c360.interventions[0]?.creneau_debut,
    notes[0]?.created_at,
    c360.dernier_mail_at,
    c360.factures[0]?.date_emission,
  );
  const cachedResume = clientRow.resume_ia ?? null;
  const cachedAt = clientRow.resume_ia_genere_le ?? null;
  if (
    !force &&
    cachedResume &&
    cachedAt &&
    (!lastActivity || new Date(cachedAt) > new Date(lastActivity))
  ) {
    return NextResponse.json({ ok: true, resume: cachedResume, genere_le: cachedAt, cached: true });
  }

  // Compléments de contexte (résumés de mails + timeline, service-role direct).
  let mails: MailRow[] = [];
  let timeline: TimelineRow[] = [];
  if (ivIds.length > 0) {
    const [mailsRes, tlRes] = await Promise.all([
      admin
        .from('mails_analyses')
        .select('resume, classification, recu_le')
        .in('dossier_match_id', ivIds)
        .not('resume', 'is', null)
        .order('recu_le', { ascending: false })
        .limit(10),
      admin
        .from('intervention_timeline')
        .select('type, message, created_at')
        .in('intervention_id', ivIds)
        .order('created_at', { ascending: false })
        .limit(30),
    ]);
    if (mailsRes.error) console.warn('[clients/resume] mails_analyses:', mailsRes.error.message);
    if (tlRes.error) console.warn('[clients/resume] timeline:', tlRes.error.message);
    mails = (mailsRes.data ?? []) as MailRow[];
    timeline = (tlRes.data ?? []) as TimelineRow[];
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: 'Génération indisponible (configuration IA manquante).' },
      { status: 502 },
    );
  }

  const contexte = buildContexte({
    clientNom: [clientRow.prenom, clientRow.nom].filter(Boolean).join(' '),
    c360,
    notes,
    mails,
    timeline,
  });

  try {
    const result = await runAgent<string | null>({
      agentName: 'resume_situation',
      agentKind: 'utility',
      model: MODEL,
      inputSummary: {
        client_id: clientRow.id,
        interventions: c360.interventions.length,
        notes: notes.length,
        mails: mails.length,
        timeline_events: timeline.length,
        factures_retard: c360.impayes.count,
        contexte_chars: contexte.length,
        force,
      },
      run: async () => {
        const client = new Anthropic({ apiKey });
        const msg = await client.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: SYSTEM,
          messages: [{ role: 'user', content: contexte }],
        });
        const block = msg.content[0];
        const text = block && block.type === 'text' ? block.text.trim() : '';
        return {
          message: msg,
          output: text || null,
          outputSummary: { resume_chars: text.length },
        };
      },
    });

    const resume = result.output;
    if (!resume) {
      return NextResponse.json(
        { ok: false, error: 'Génération du résumé indisponible.' },
        { status: 502 },
      );
    }

    const genereLe = new Date().toISOString();
    const { error: updateErr } = await admin
      .from('clients')
      .update({ resume_ia: resume, resume_ia_genere_le: genereLe, updated_at: genereLe })
      .eq('id', clientRow.id);
    if (updateErr) console.warn('[clients/resume] persistance:', updateErr.message);

    return NextResponse.json({ ok: true, resume, genere_le: genereLe, cached: false });
  } catch (e) {
    console.error('[clients/resume] génération:', e);
    return NextResponse.json(
      { ok: false, error: 'Génération du résumé indisponible.' },
      { status: 502 },
    );
  }
}
