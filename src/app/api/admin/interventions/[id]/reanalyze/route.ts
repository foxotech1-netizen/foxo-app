import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';
import { getMailDetail } from '@/lib/gmail';
import { analyzeMailWithClaude } from '@/lib/cron/check-mails';
import type { Intervention } from '@/lib/types/database';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Réanalyse le mail original d'une intervention source='mail'.
// Renvoie l'analyse SANS modifier l'intervention — l'admin valide
// avant d'écraser via /apply-reanalysis (PATCH /[id] + insert occupants).
//
// Si Google non connecté → 503 google_not_connected.
// Si pas de source_mail_id → 400.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { id } = await params;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'ANTHROPIC_API_KEY manquante côté serveur.' }, { status: 500 });
  }

  const { data: ivRow, error: ivErr } = await supabase
    .from('interventions')
    .select('id, ref, source, source_mail_id, particulier_contact, type, description, priorite, adresse, organisation_id, client_id')
    .eq('id', id)
    .maybeSingle();
  if (ivErr) return NextResponse.json({ ok: false, error: ivErr.message }, { status: 500 });
  if (!ivRow) return NextResponse.json({ ok: false, error: 'Intervention introuvable.' }, { status: 404 });
  const intervention = ivRow as Pick<Intervention,
    'id' | 'ref' | 'source' | 'source_mail_id' | 'particulier_contact' |
    'type' | 'description' | 'priorite' | 'adresse' | 'organisation_id' | 'client_id'>;

  const mailId = (intervention as { source_mail_id?: string | null }).source_mail_id;
  console.info('[reanalyze] start', { intervention_id: id, ref: intervention.ref, source_mail_id: mailId });
  if (!mailId) {
    console.warn('[reanalyze] aborted: source_mail_id is null', { ref: intervention.ref });
    return NextResponse.json({ ok: false, error: 'Pas de mail source.' }, { status: 400 });
  }

  // Récupère le mail complet
  const mailRes = await getMailDetail(mailId);
  if (!mailRes.ok) {
    console.error('[reanalyze] getMailDetail failed', { mailId, error: mailRes.error });
    if (mailRes.error === 'Google non connecté.') {
      return NextResponse.json({ ok: false, error: mailRes.error, code: 'google_not_connected' }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: mailRes.error }, { status: 502 });
  }
  const mail = mailRes.mail;

  // Log structurel — visible dans Vercel runtime logs
  console.info('[reanalyze] gmail fetched', {
    mailId,
    from: mail.from,
    subject: mail.subject,
    cc: mail.cc,
    cc_length: (mail.cc ?? '').length,
    body_text_length: (mail.body_text ?? '').length,
    body_html_length: (mail.body_html ?? '').length,
    body_text_preview: (mail.body_text ?? '').slice(0, 500),
    body_html_preview: (mail.body_html ?? '').slice(0, 500),
  });

  const analyzeRes = await analyzeMailWithClaude(apiKey, {
    from: mail.from,
    subject: mail.subject,
    date: mail.date,
    cc: mail.cc,
    body_text: mail.body_text,
    body_html: mail.body_html,
  });
  if (!analyzeRes.ok) {
    console.error('[reanalyze] analyzeMailWithClaude failed', { mailId, error: analyzeRes.error });
    return NextResponse.json({ ok: false, error: analyzeRes.error }, { status: 502 });
  }

  console.info('[reanalyze] claude result', {
    mailId,
    est_demande: analyzeRes.analysis.est_demande_intervention,
    type_demandeur: analyzeRes.analysis.type_demandeur,
    nom_societe: analyzeRes.analysis.nom_societe,
    occupants_count: analyzeRes.analysis.occupants?.length ?? 0,
    occupants: analyzeRes.analysis.occupants,
  });

  return NextResponse.json({
    ok: true,
    analysis: analyzeRes.analysis,
    current_intervention: {
      ref: intervention.ref,
      type: intervention.type,
      description: intervention.description,
      priorite: intervention.priorite,
      adresse: intervention.adresse,
      particulier_contact: intervention.particulier_contact,
      organisation_id: intervention.organisation_id,
      client_id: intervention.client_id,
    },
  });
}
