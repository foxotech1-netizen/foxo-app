// POST /api/admin/mails/draft-reply
// Body : { thread_id: string, target: 'syndic' | 'occupant' }
// Response : { success, draft_id, gmail_url }
//
// Génère un brouillon Gmail rattaché au thread d'origine pour répondre
// soit au syndic (confirmation prise en charge + créneau), soit à
// l'occupant (proposition créneau + demande de confirmation).
// AUCUN ENVOI — l'admin valide depuis Gmail web.

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from "@/lib/auth/server";
import { getEmailThread, createGmailDraft } from '@/lib/gmail';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MODEL = 'claude-sonnet-4-6';

interface DraftReplyBody {
  thread_id?: unknown;
  target?: unknown;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ success: false, error: 'Accès refusé.' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as DraftReplyBody;
  const threadId = typeof body.thread_id === 'string' ? body.thread_id.trim() : '';
  const target = body.target === 'syndic' || body.target === 'occupant' ? body.target : null;
  if (!threadId || !target) {
    return NextResponse.json({ success: false, error: 'thread_id + target requis.' }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ success: false, error: 'ANTHROPIC_API_KEY manquante.' }, { status: 500 });

  const admin = createAdminClient();

  // 1. Récup mails_analyses
  const { data: analyseRow, error: anaErr } = await admin
    .from('mails_analyses')
    .select('*')
    .eq('thread_id', threadId)
    .maybeSingle();
  if (anaErr) return NextResponse.json({ success: false, error: anaErr.message }, { status: 500 });
  if (!analyseRow) {
    return NextResponse.json(
      { success: false, error: 'Mail non analysé, lancer analyse-deep d\'abord.' },
      { status: 404 },
    );
  }
  const analyse = analyseRow as {
    langue: string | null;
    occupant_email: string | null;
    occupant_telephone: string | null;
    resume: string | null;
    dossier_match_id: string | null;
    creneau_propose_id: string | null;
  };

  // 2. Récup dossier (ref + adresse + syndic)
  type DossierLite = { ref: string | null; adresse: string | null; syndic_id: string | null };
  let dossier: DossierLite | null = null;
  if (analyse.dossier_match_id) {
    const { data } = await admin
      .from('interventions')
      .select('ref, adresse, syndic_id')
      .eq('id', analyse.dossier_match_id)
      .maybeSingle();
    if (data) dossier = data as DossierLite;
  }

  // 3. Récup syndic email (si target=syndic)
  let syndicEmail: string | null = null;
  let syndicNom: string | null = null;
  if (target === 'syndic' && dossier?.syndic_id) {
    const { data } = await admin
      .from('organisations')
      .select('nom, email')
      .eq('id', dossier.syndic_id)
      .maybeSingle();
    if (data) {
      const o = data as { nom: string | null; email: string | null };
      syndicEmail = o.email;
      syndicNom = o.nom;
    }
  }

  // 4. Récup créneau proposé (date + heure + technicien)
  let creneauInfo: { date: string; heure_debut: string; heure_fin: string; technicien_nom: string } | null = null;
  if (analyse.creneau_propose_id) {
    const { data: cre } = await admin
      .from('creneaux_disponibles')
      .select('date, heure_debut, heure_fin, technicien_id')
      .eq('id', analyse.creneau_propose_id)
      .maybeSingle();
    if (cre) {
      const c = cre as { date: string; heure_debut: string; heure_fin: string; technicien_id: string | null };
      let techNom = '?';
      if (c.technicien_id) {
        const { data: tech } = await admin
          .from('utilisateurs')
          .select('prenom, nom')
          .eq('id', c.technicien_id)
          .maybeSingle();
        if (tech) {
          const t = tech as { prenom: string | null; nom: string | null };
          techNom = [t.prenom, t.nom].filter(Boolean).join(' ').trim() || 'Technicien';
        }
      }
      creneauInfo = {
        date: c.date,
        heure_debut: c.heure_debut.slice(0, 5),
        heure_fin: c.heure_fin.slice(0, 5),
        technicien_nom: techNom,
      };
    }
  }

  // 5. Détermine destinataire
  const toRecipient = target === 'syndic' ? syndicEmail : analyse.occupant_email;
  if (!toRecipient) {
    return NextResponse.json(
      { success: false, error: `Destinataire ${target} introuvable (email manquant).` },
      { status: 400 },
    );
  }

  // 6. Récup dernier message du thread (pour l'origine des en-têtes In-Reply-To)
  const threadRes = await getEmailThread(threadId);
  if (!threadRes.ok) {
    return NextResponse.json({ success: false, error: threadRes.error }, { status: 502 });
  }
  if (threadRes.messages.length === 0) {
    return NextResponse.json({ success: false, error: 'Thread vide.' }, { status: 404 });
  }
  // Le plus récent = dernier de la liste (Gmail trie par date asc).
  const lastMsg = threadRes.messages[threadRes.messages.length - 1];

  // 7. Génération du body via Claude
  const langueSpoken = analyse.langue === 'nl' ? 'NL'
    : analyse.langue === 'en' ? 'EN'
    : 'FR';
  const dateLabel = creneauInfo
    ? formatDateFr(creneauInfo.date)
    : null;

  const systemPrompt = [
    `Tu rédiges un mail professionnel court (max 150 mots) au nom de FoxO`,
    `(détection de fuites non destructive en Belgique).`,
    `Ton : professionnel, cordial, direct. Pas d'emojis, pas de markdown.`,
    `Signature obligatoire en fin de mail : "Christophe Mertens — FoxO"`,
    ``,
    `Langue de réponse : ${langueSpoken === 'NL' ? 'Néerlandais' : langueSpoken === 'EN' ? 'Anglais' : 'Français'}`,
    ``,
    target === 'syndic'
      ? `Cible : SYNDIC. Confirme la prise en charge du dossier${dossier?.ref ? ' ' + dossier.ref : ''}. Mentionne la date proposée et le nom du technicien si disponibles. Ne demande pas confirmation, c'est une notification.`
      : `Cible : OCCUPANT. Propose le créneau de RDV pour la détection de fuite. Mentionne la date, l'heure et la durée approximative (1h30). Demande une confirmation par retour.`,
    ``,
    `Retourne UNIQUEMENT le corps du mail (pas de "Objet:", pas de "Bonjour [Nom]" si tu ne connais pas le nom — utilise un "Bonjour," neutre).`,
  ].join('\n');

  const ctxParts: string[] = [];
  if (dossier) {
    ctxParts.push(`Dossier : ${dossier.ref ?? '?'} — ${dossier.adresse ?? '?'}`);
    if (target === 'syndic' && syndicNom) ctxParts.push(`Syndic destinataire : ${syndicNom}`);
  }
  if (creneauInfo && dateLabel) {
    ctxParts.push(`Créneau proposé : ${dateLabel} de ${creneauInfo.heure_debut} à ${creneauInfo.heure_fin}`);
    ctxParts.push(`Technicien assigné : ${creneauInfo.technicien_nom}`);
  }
  if (analyse.resume) ctxParts.push(`Contexte de la demande initiale : ${analyse.resume}`);

  const userPrompt = `Contexte :\n${ctxParts.join('\n') || '(aucun contexte spécifique)'}\n\nRédige le corps du mail.`;

  let bodyText: string;
  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      temperature: 0.5,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const block = msg.content[0];
    bodyText = block && block.type === 'text' ? block.text.trim() : '';
    if (!bodyText) throw new Error('Réponse Claude vide.');
  } catch (e) {
    return NextResponse.json(
      { success: false, error: `Anthropic : ${e instanceof Error ? e.message : 'inconnu'}` },
      { status: 502 },
    );
  }

  // 8. Création du brouillon Gmail (pas d'envoi)
  const draftRes = await createGmailDraft({
    mailId: lastMsg.id,
    to: toRecipient,
    body: bodyText,
  });
  if (!draftRes.ok) {
    return NextResponse.json({ success: false, error: draftRes.error }, { status: 502 });
  }

  // 9. UPDATE mails_analyses.brouillon_gmail_id
  await admin
    .from('mails_analyses')
    .update({ brouillon_gmail_id: draftRes.draft_id, updated_at: new Date().toISOString() })
    .eq('thread_id', threadId);

  return NextResponse.json({
    success: true,
    draft_id: draftRes.draft_id,
    gmail_url: draftRes.gmail_url,
  });
}

function formatDateFr(iso: string): string {
  // 'YYYY-MM-DD' → 'jeudi 15 mai 2026'
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString('fr-BE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
