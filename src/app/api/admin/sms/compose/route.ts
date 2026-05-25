// POST /api/admin/sms/compose
// Body : { thread_id: string }
// Response : { success, phone, body }
//
// Génère un SMS court (≤ 160 chars) de confirmation RDV pour l'occupant
// du dossier rattaché au thread analysé. Pas d'envoi — l'UI affiche
// le texte pour validation avant POST /api/admin/sms/send.

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from "@/lib/auth/server";
import { formatBelgianPhone } from '@/lib/sms';
import { runAgent } from '@/lib/observability';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MODEL = 'claude-sonnet-4-6';

interface ComposeBody {
  thread_id?: unknown;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ success: false, error: 'Accès refusé.' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as ComposeBody;
  const threadId = typeof body.thread_id === 'string' ? body.thread_id.trim() : '';
  if (!threadId) {
    return NextResponse.json({ success: false, error: 'thread_id requis.' }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ success: false, error: 'ANTHROPIC_API_KEY manquante.' }, { status: 500 });

  const admin = createAdminClient();

  // Récup analyse + dossier + créneau (mêmes lookups que draft-reply)
  const { data: analyseRow, error: anaErr } = await admin
    .from('mails_analyses')
    .select('*')
    .eq('thread_id', threadId)
    .maybeSingle();
  if (anaErr) return NextResponse.json({ success: false, error: anaErr.message }, { status: 500 });
  if (!analyseRow) {
    return NextResponse.json(
      { success: false, error: 'Mail non analysé.' },
      { status: 404 },
    );
  }
  const analyse = analyseRow as {
    occupant_telephone: string | null;
    dossier_match_id: string | null;
    creneau_propose_id: string | null;
  };

  if (!analyse.occupant_telephone) {
    return NextResponse.json(
      { success: false, error: 'Téléphone occupant manquant dans l\'analyse.' },
      { status: 400 },
    );
  }
  const phone = formatBelgianPhone(analyse.occupant_telephone);

  let dossierAdresse: string | null = null;
  if (analyse.dossier_match_id) {
    const { data } = await admin
      .from('interventions')
      .select('adresse')
      .eq('id', analyse.dossier_match_id)
      .maybeSingle();
    dossierAdresse = (data as { adresse: string | null } | null)?.adresse ?? null;
  }

  let creneauInfo: { date: string; heure_debut: string; technicien_nom: string } | null = null;
  if (analyse.creneau_propose_id) {
    const { data: cre } = await admin
      .from('creneaux_disponibles')
      .select('date, heure_debut, technicien_id')
      .eq('id', analyse.creneau_propose_id)
      .maybeSingle();
    if (cre) {
      const c = cre as { date: string; heure_debut: string; technicien_id: string | null };
      let techNom = 'FoxO';
      if (c.technicien_id) {
        const { data: tech } = await admin
          .from('utilisateurs')
          .select('prenom')
          .eq('id', c.technicien_id)
          .maybeSingle();
        if (tech) {
          techNom = (tech as { prenom: string | null }).prenom ?? 'FoxO';
        }
      }
      creneauInfo = {
        date: c.date,
        heure_debut: c.heure_debut.slice(0, 5),
        technicien_nom: techNom,
      };
    }
  }

  const systemPrompt = [
    `Tu rédiges un SMS court (max 160 caractères, IMPÉRATIF) en français pour confirmer un RDV FoxO de détection de fuite.`,
    ``,
    `Format type :`,
    `"Bonjour, FoxO confirme votre RDV le [date] à [heure]. Tech: [nom]. Adresse: [adresse]. Merci de confirmer par retour."`,
    ``,
    `Règles :`,
    `- Reste sous 160 caractères, ABSOLUMENT.`,
    `- Pas d'emojis, pas de markdown, pas de signature séparée (FoxO est mentionné dans le corps).`,
    `- Date courte format "Mar 15/05" si possible pour gagner des chars.`,
    ``,
    `Retourne UNIQUEMENT le texte du SMS, sans guillemets autour.`,
  ].join('\n');

  const ctxParts: string[] = [];
  if (creneauInfo) {
    ctxParts.push(`Date : ${formatDateShort(creneauInfo.date)}`);
    ctxParts.push(`Heure : ${creneauInfo.heure_debut}`);
    ctxParts.push(`Tech : ${creneauInfo.technicien_nom}`);
  }
  if (dossierAdresse) ctxParts.push(`Adresse : ${dossierAdresse}`);

  const userPrompt = ctxParts.length > 0
    ? `Contexte :\n${ctxParts.join('\n')}\n\nRédige le SMS.`
    : `Aucun créneau ni adresse — rédige un SMS générique demandant de prendre contact pour fixer un RDV.`;

  let smsBody: string;
  try {
    const { output } = await runAgent<string>({
      agentName: 'sms_compose',
      agentKind: 'utility',
      model: MODEL,
      interventionId: analyse.dossier_match_id ?? null,
      inputSummary: {
        has_creneau:        creneauInfo !== null,
        has_adresse:        dossierAdresse !== null,
        prompt_user_chars:  userPrompt.length,
      },
      run: async () => {
        const client = new Anthropic({ apiKey });
        const msg = await client.messages.create({
          model: MODEL,
          max_tokens: 200,
          temperature: 0.3,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        });
        const block = msg.content[0];
        let text = block && block.type === 'text' ? block.text.trim() : '';
        if (!text) throw new Error('Réponse Claude vide.');
        // Strip guillemets éventuels (Claude en met parfois malgré la consigne)
        text = text.replace(/^["']|["']$/g, '').trim();
        return {
          message: msg,
          output: text,
          outputSummary: {
            sms_chars:       text.length,
            sms_over_limit:  text.length > 160,
          },
        };
      },
    });
    smsBody = output;
  } catch (e) {
    return NextResponse.json(
      { success: false, error: `Anthropic : ${e instanceof Error ? e.message : 'inconnu'}` },
      { status: 502 },
    );
  }

  return NextResponse.json({ success: true, phone, body: smsBody });
}

function formatDateShort(iso: string): string {
  // 'YYYY-MM-DD' → 'Mar 15/05'
  const d = new Date(`${iso}T12:00:00Z`);
  const wd = d.toLocaleDateString('fr-BE', { weekday: 'short' });
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${wd} ${dd}/${mm}`;
}
