'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';
import { sendSMS, sendWhatsApp, logSmsSend, applyTemplateVars } from '@/lib/sms';

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

async function assertAdmin(): Promise<{ ok: true; email: string | null } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return { ok: false, error: 'Accès refusé.' };
  }
  return { ok: true, email: user.email ?? null };
}

export interface SendSmsInput {
  to: string;                                // numéro brut (le backend reformate)
  channel: 'sms' | 'whatsapp';
  message: string;
  intervention_id?: string | null;
  occupant_id?: string | null;
}

export async function sendSmsAction(input: SendSmsInput): Promise<ActionResult<{ sid: string }>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  if (!input.to?.trim()) return { ok: false, error: 'Numéro vide.' };
  if (!input.message?.trim()) return { ok: false, error: 'Message vide.' };

  const result = input.channel === 'whatsapp'
    ? await sendWhatsApp(input.to, input.message)
    : await sendSMS(input.to, input.message);

  await logSmsSend({
    intervention_id: input.intervention_id ?? null,
    occupant_id: input.occupant_id ?? null,
    to_phone: input.to,
    channel: input.channel,
    message: input.message,
    result,
    sent_by: guard.email,
  });

  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath('/admin');
  return { ok: true, data: { sid: result.sid } };
}

// Renvoie un message pré-rempli depuis un template de paramètres pour
// une intervention + occupant donnés. Côté admin uniquement.
export async function buildSmsPreview(input: {
  template_key: 'sms_template_confirmation' | 'sms_template_rappel_24h' | 'sms_template_rapport' | 'sms_template_lien_occupant';
  intervention_id: string;
  occupant_id?: string | null;
}): Promise<ActionResult<{ message: string; to: string; channel: 'sms' | 'whatsapp' }>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const supabase = await createClient();
  const [{ data: param }, { data: iv }, { data: occ }] = await Promise.all([
    supabase.from('parametres').select('valeur').eq('cle', input.template_key).maybeSingle(),
    supabase.from('interventions')
      .select('id, ref, creneau_debut, adresse, acp:acps(adresse, code_postal, ville)')
      .eq('id', input.intervention_id)
      .maybeSingle(),
    input.occupant_id
      ? supabase.from('occupants').select('*').eq('id', input.occupant_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const template = param?.valeur ?? '';
  if (!template) return { ok: false, error: 'Template introuvable.' };
  if (!iv) return { ok: false, error: 'Intervention introuvable.' };

  type IvJoined = { id: string; ref: string | null; creneau_debut: string | null; adresse: string | null;
    acp: { adresse: string | null; code_postal: string | null; ville: string | null } | null; };
  const ivT = iv as unknown as IvJoined;

  const date = ivT.creneau_debut
    ? new Date(ivT.creneau_debut).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' })
    : '';
  const heure = ivT.creneau_debut
    ? new Date(ivT.creneau_debut).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
    : '';
  const adresse = ivT.acp
    ? [ivT.acp.adresse, ivT.acp.code_postal, ivT.acp.ville].filter(Boolean).join(', ')
    : (ivT.adresse ?? '');

  type OccRow = {
    prenom: string | null; nom: string | null; telephone: string | null;
    contact_preference: string | null; token: string | null;
  };
  const occT = occ as OccRow | null;
  const lienToken = occT?.token ?? '';
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://foxo.be';
  const lien = lienToken ? `${baseUrl}/o/${lienToken}` : `${baseUrl}/`;

  const message = applyTemplateVars(template, {
    Prenom: occT?.prenom ?? '',
    date,
    heure,
    adresse,
    lien,
  });

  const to = occT?.telephone ?? '';
  const pref = (occT?.contact_preference ?? 'email').toLowerCase();
  const channel: 'sms' | 'whatsapp' = pref === 'whatsapp' ? 'whatsapp' : 'sms';

  return { ok: true, data: { message, to, channel } };
}

export async function testSmsAction(input: { to: string; channel: 'sms' | 'whatsapp' }): Promise<ActionResult> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  const message = `[Test FoxO] Envoi de test depuis /admin/parametres — ${new Date().toLocaleTimeString('fr-BE')}.`;
  const result = input.channel === 'whatsapp'
    ? await sendWhatsApp(input.to, message)
    : await sendSMS(input.to, message);
  await logSmsSend({
    to_phone: input.to,
    channel: input.channel,
    message,
    result,
    sent_by: guard.email,
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}
