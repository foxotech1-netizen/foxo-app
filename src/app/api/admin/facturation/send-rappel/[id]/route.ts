import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from "@/lib/auth/server";
import { sendEmailResend } from '@/lib/email/resend';
import { VENDOR_BILLING_FROM } from '@/lib/constants/vendor';
import { getEmailForDoc } from '@/lib/notifications';
import type { Facture } from '@/lib/types/database';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const DEFAULT_TEMPLATE =
  'Bonjour,\n\nNous vous rappelons que la facture {ref} d\'un montant de {montant} € est en attente de règlement depuis {jours} jours.\n\nMerci de procéder au paiement dans les meilleurs délais.\n\nCordialement,\nFoxO';

function fmtMoney(n: number | null | undefined): string {
  const v = typeof n === 'number' ? n : 0;
  return v.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function daysSince(iso: string | null): number {
  if (!iso) return 0;
  const t = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(t / 86_400_000));
}

function fillTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_m, key) => vars[key] ?? `{${key}}`);
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { id } = await params;

  // Charge la facture + intervention liée pour résoudre l'email destinataire
  const { data: factureRow, error: fErr } = await supabase
    .from('factures')
    .select('*, intervention:interventions(id, syndic:organisations(id, email, email_factures, email_communications), acp:acps(id, email_factures, email_facturation, email_communications), particulier_contact)')
    .eq('id', id)
    .maybeSingle();

  if (fErr || !factureRow) {
    return NextResponse.json({ ok: false, error: fErr?.message ?? 'Facture introuvable.' }, { status: 404 });
  }

  type IvJoin = {
    id: string;
    syndic: { id: string; email: string | null; email_factures: string | null; email_communications: string | null } | null;
    acp: { id: string; email_factures: string | null; email_facturation: string | null; email_communications: string | null } | null;
    particulier_contact: { email?: string } | null;
  };
  const fact = factureRow as Facture & { intervention: IvJoin | IvJoin[] | null };
  const ivRel = Array.isArray(fact.intervention) ? fact.intervention[0] : fact.intervention;

  // Résolution email — ordre de priorité géré par getEmailForDoc :
  // ACP.email_factures > syndic.email_factures > legacy > syndic.email général
  // > particulier_contact.email. En dernier recours, fallback sur
  // facture.client_email saisi à la main.
  const resolved = getEmailForDoc(
    {
      acp: ivRel?.acp ? {
        email_factures: ivRel.acp.email_factures,
        email_communications: ivRel.acp.email_communications,
        email_rapports: null,
        email_facturation: ivRel.acp.email_facturation,
        email_rapport: null,
      } : null,
      syndic: ivRel?.syndic ? {
        email: ivRel.syndic.email ?? '',
        email_factures: ivRel.syndic.email_factures,
        email_communications: ivRel.syndic.email_communications,
        email_rapports: null,
      } : null,
      particulier_contact: ivRel?.particulier_contact ?? null,
    },
    'facture',
  );
  const targetEmail = resolved.email ?? ((fact.client_email ?? '').trim() || null);
  if (!targetEmail) {
    return NextResponse.json({ ok: false, error: 'Email destinataire introuvable (configure email_factures sur l\'ACP/syndic ou client_email sur la facture).' }, { status: 400 });
  }

  // Charge le template depuis parametres
  const { data: tplParam } = await supabase
    .from('parametres').select('valeur').eq('cle', 'rappel_template_email').maybeSingle();
  const template = (tplParam?.valeur as string | null) || DEFAULT_TEMPLATE;

  const referenceDate = fact.date_echeance || fact.date_emission;
  const jours = daysSince(referenceDate);
  const body = fillTemplate(template, {
    ref: fact.numero,
    montant: fmtMoney(fact.montant_ttc),
    jours: String(jours),
    client: fact.client_nom ?? 'Client',
  });
  const subject = `Rappel — facture ${fact.numero} en attente de règlement`;

  // Convertit le texte plain → HTML simple (escape + newlines en <br>)
  const escapeHtml = (s: string) => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#1A1816">
    ${escapeHtml(body).replace(/\n/g, '<br>')}
  </div>`;

  // Envoie via Resend (domaine send.foxo.be — l'alias Gmail info@foxo.be
  // est HS depuis la migration Workspace).
  const send = await sendEmailResend({
    to: targetEmail,
    subject,
    html,
    text: body,
    from: VENDOR_BILLING_FROM,
  });
  if (!send.ok) {
    return NextResponse.json({ ok: false, error: send.error }, { status: 500 });
  }

  // Met à jour la facture (rappel_envoye_at + rappel_count). Si la
  // migration 2026-05-16 n'est pas appliquée, on ignore silencieusement
  // (la 500 ici ne doit pas masquer le fait que l'email est parti).
  try {
    const newCount = (fact.rappel_count ?? 0) + 1;
    await supabase
      .from('factures')
      .update({
        rappel_envoye_at: new Date().toISOString(),
        rappel_count: newCount,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
  } catch { /* noop — migration peut être pending */ }

  // Log dans sms_logs (timeline d'envois admin — même table que les SMS)
  try {
    await supabase.from('sms_logs').insert({
      intervention_id: ivRel?.id ?? null,
      to_phone: targetEmail,
      channel: 'email',
      type: 'facture_rappel',
      message: `Rappel facture ${fact.numero} (${fmtMoney(fact.montant_ttc)} €, ${jours}j de retard) → ${targetEmail}`,
      status: 'sent',
      cost_estimate_eur: 0,
      sent_by: user.email ?? 'admin',
      twilio_sid: send.id,
    });
  } catch { /* noop log */ }

  return NextResponse.json({
    ok: true,
    email_sent_to: targetEmail,
    rappel_count: (fact.rappel_count ?? 0) + 1,
  });
}
