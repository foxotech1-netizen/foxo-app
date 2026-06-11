// Envoi SMS / WhatsApp via Twilio.
//
// Stratégie :
//   1. On lit les credentials Twilio en priorité depuis les variables d'env
//      (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER,
//       TWILIO_WHATSAPP_NUMBER) — déploiement Vercel.
//   2. Sinon, fallback sur la table `parametres` (clés twilio_*).
//   3. Sinon, log console + retour ok=false avec error explicite.
//
// Pas de SDK Twilio installé — on utilise fetch() directement vers
// l'endpoint REST. Auth basique avec Account SID + Auth Token.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export type SmsResult =
  | { ok: true; sid: string; channel: 'sms' | 'whatsapp' }
  | { ok: false; error: string };

interface TwilioConfig {
  accountSid: string;
  authToken: string;
  smsFrom: string;
  whatsappFrom: string;
  smsEnabled: boolean;
  whatsappEnabled: boolean;
}

async function loadTwilioConfig(): Promise<TwilioConfig> {
  // Env vars en priorité
  const envSid = process.env.TWILIO_ACCOUNT_SID ?? '';
  const envToken = process.env.TWILIO_AUTH_TOKEN ?? '';
  const envSms = process.env.TWILIO_PHONE_NUMBER ?? '';
  const envWa = process.env.TWILIO_WHATSAPP_NUMBER ?? '';

  // Fallback DB parametres
  const dbConfig: Record<string, string> = {};
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from('parametres')
      .select('cle, valeur')
      .in('cle', [
        'twilio_account_sid',
        'twilio_auth_token',
        'twilio_phone_number',
        'twilio_whatsapp_number',
        'sms_enabled',
        'whatsapp_enabled',
      ]);
    for (const p of data ?? []) {
      if (p.valeur != null) dbConfig[p.cle] = p.valeur;
    }
  } catch {
    /* noop */
  }

  return {
    accountSid: envSid || dbConfig.twilio_account_sid || '',
    authToken: envToken || dbConfig.twilio_auth_token || '',
    smsFrom: envSms || dbConfig.twilio_phone_number || '',
    whatsappFrom: envWa || dbConfig.twilio_whatsapp_number || '',
    smsEnabled: dbConfig.sms_enabled === 'true' || Boolean(envSid && envSms),
    whatsappEnabled: dbConfig.whatsapp_enabled === 'true' || Boolean(envSid && envWa),
  };
}

// Format E.164 belge : "0488700007" → "+32488700007", "0488 70 00 07" → idem
export function formatBelgianPhone(input: string | null | undefined): string {
  if (!input) return '';
  const cleaned = input.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.startsWith('00')) return '+' + cleaned.slice(2);
  if (cleaned.startsWith('0')) return '+32' + cleaned.slice(1);
  // déjà sans le 0 mais sans +32 → on suppose belge
  if (/^[1-9]\d{7,8}$/.test(cleaned)) return '+32' + cleaned;
  return cleaned;
}

// Coût estimé d'un message en EUR (basé sur tarif Twilio ~0.05€/SMS BE).
export function estimateSmsCost(message: string): { segments: number; eur: number } {
  if (!message) return { segments: 0, eur: 0 };
  const len = message.length;
  // GSM-7 standard : 160 chars/segment, 153 par segment si concaténé.
  // Si caractères non-GSM (emoji, etc.) → UCS-2 70/67 chars.
  const isUnicode = /[^\x00-\x7F€£]/.test(message);
  const single = isUnicode ? 70 : 160;
  const concat = isUnicode ? 67 : 153;
  const segments = len <= single ? 1 : Math.ceil(len / concat);
  return { segments, eur: Math.round(segments * 0.05 * 100) / 100 };
}

async function postTwilio(
  cfg: TwilioConfig,
  to: string,
  from: string,
  message: string,
): Promise<SmsResult> {
  if (!cfg.accountSid || !cfg.authToken) {
    return { ok: false, error: 'Twilio non configuré (Account SID ou Auth Token manquant).' };
  }
  if (!from) {
    return { ok: false, error: 'Numéro Twilio expéditeur non configuré.' };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`;
  const auth = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64');
  const body = new URLSearchParams({ To: to, From: from, Body: message });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `Twilio HTTP ${res.status} : ${txt.slice(0, 200)}` };
    }
    const data = await res.json() as { sid?: string };
    return { ok: true, sid: data.sid ?? '', channel: from.startsWith('whatsapp:') ? 'whatsapp' : 'sms' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur réseau.' };
  }
}

export async function sendSMS(toRaw: string, message: string): Promise<SmsResult> {
  const to = formatBelgianPhone(toRaw);
  if (!to) return { ok: false, error: 'Numéro de téléphone vide.' };
  if (!message?.trim()) return { ok: false, error: 'Message vide.' };

  const cfg = await loadTwilioConfig();
  if (!cfg.accountSid || !cfg.smsFrom) {
    console.info('[sms] Non configuré — message simulé pour', to, ':', message);
    return { ok: false, error: 'Twilio SMS non configuré (mode log uniquement).' };
  }
  if (!cfg.smsEnabled) {
    return { ok: false, error: 'SMS désactivés dans /admin/parametres.' };
  }

  return postTwilio(cfg, to, cfg.smsFrom, message);
}

export async function sendWhatsApp(toRaw: string, message: string): Promise<SmsResult> {
  const to = formatBelgianPhone(toRaw);
  if (!to) return { ok: false, error: 'Numéro de téléphone vide.' };
  if (!message?.trim()) return { ok: false, error: 'Message vide.' };

  const cfg = await loadTwilioConfig();
  if (!cfg.accountSid || !cfg.whatsappFrom) {
    console.info('[whatsapp] Non configuré — message simulé pour', to, ':', message);
    return { ok: false, error: 'Twilio WhatsApp non configuré (mode log uniquement).' };
  }
  if (!cfg.whatsappEnabled) {
    return { ok: false, error: 'WhatsApp désactivé dans /admin/parametres.' };
  }

  const fromWa = cfg.whatsappFrom.startsWith('whatsapp:') ? cfg.whatsappFrom : `whatsapp:${cfg.whatsappFrom}`;
  const toWa = `whatsapp:${to}`;
  return postTwilio(cfg, toWa, fromWa, message);
}

// Persistance log SMS dans la table sms_logs (admin client pour bypass RLS
// si appelé sans session utilisateur, ex: cron rappel 24h).
export async function logSmsSend(args: {
  intervention_id?: string | null;
  occupant_id?: string | null;
  to_phone: string;
  channel: 'sms' | 'whatsapp';
  message: string;
  result: SmsResult;
  sent_by?: string | null;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const cost = estimateSmsCost(args.message).eur;
    await admin.from('sms_logs').insert({
      intervention_id: args.intervention_id ?? null,
      occupant_id: args.occupant_id ?? null,
      to_phone: args.to_phone,
      channel: args.channel,
      message: args.message,
      status: args.result.ok ? 'sent' : 'failed',
      twilio_sid: args.result.ok ? args.result.sid : null,
      error: args.result.ok ? null : args.result.error,
      cost_estimate_eur: cost,
      sent_by: args.sent_by ?? null,
    });
  } catch (e) {
    console.warn('[sms_logs] insert failed:', e);
  }
}

// Substitue les variables [Prénom], [date], [heure], [adresse], [lien]
// dans un template de message.
export function applyTemplateVars(
  template: string,
  vars: { Prenom?: string; date?: string; heure?: string; adresse?: string; lien?: string },
): string {
  return template
    .replace(/\[Prénom\]/g, vars.Prenom ?? '')
    .replace(/\[Prenom\]/g, vars.Prenom ?? '')
    .replace(/\[date\]/g, vars.date ?? '')
    .replace(/\[heure\]/g, vars.heure ?? '')
    .replace(/\[adresse\]/g, vars.adresse ?? '')
    .replace(/\[lien\]/g, vars.lien ?? '');
}
