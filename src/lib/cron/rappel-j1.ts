// Logique partagée entre POST /api/cron/rappel-j1 (envoi) et
// GET /api/cron/rappel-j1/preview (dry-run).

import { createAdminClient } from '@/lib/supabase/admin';
import { sendSMS, sendWhatsApp, applyTemplateVars, logSmsSend } from '@/lib/sms';
import { sendRappelJ1Email } from '@/lib/email/rappel-j1';
import { VENDOR } from '@/lib/constants/vendor';

export interface RappelTarget {
  intervention_id: string;
  ref: string | null;
  creneau_debut: string;
  occupant_id: string;
  occupant_prenom: string | null;
  occupant_email: string | null;
  occupant_telephone: string | null;
  contact_preference: 'email' | 'sms' | 'whatsapp' | 'both';
  adresse: string;
}

interface RawIntervention {
  id: string;
  ref: string | null;
  creneau_debut: string;
  adresse: string | null;
  acp: { adresse: string | null; code_postal: string | null; ville: string | null } | null;
}

interface RawOccupant {
  id: string;
  intervention_id: string;
  prenom: string | null;
  email: string | null;
  telephone: string | null;
  conf: string | null;
  contact_preference: string | null;
}

// Fenêtre [demain 00:00, après-demain 00:00) en local Bruxelles. Comme on
// stocke en timestamptz côté DB, on calcule en UTC ici via Europe/Brussels.
function tomorrowWindow(): { from: string; to: string; label: string } {
  const now = new Date();
  // On reste pragmatique : "demain" = JJ+1 par rapport à la date locale serveur
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const after = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
  return {
    from: tomorrow.toISOString(),
    to: after.toISOString(),
    label: tomorrow.toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' }),
  };
}

export async function listJ1Targets(): Promise<RappelTarget[]> {
  const admin = createAdminClient();
  const w = tomorrowWindow();

  const { data: ivs, error } = await admin
    .from('interventions')
    .select('id, ref, creneau_debut, adresse, acp:acps(adresse, code_postal, ville)')
    .eq('statut', 'confirmee')
    .gte('creneau_debut', w.from)
    .lt('creneau_debut', w.to);
  if (error || !ivs) return [];

  const interventions = ivs as unknown as RawIntervention[];
  const ivIds = interventions.map((i) => i.id);
  if (ivIds.length === 0) return [];

  const { data: occRows } = await admin
    .from('occupants')
    .select('id, intervention_id, prenom, email, telephone, conf, contact_preference')
    .in('intervention_id', ivIds)
    .eq('conf', 'confirme');
  const occupants = (occRows ?? []) as RawOccupant[];

  const ivById = new Map(interventions.map((i) => [i.id, i]));
  const out: RappelTarget[] = [];

  for (const o of occupants) {
    const iv = ivById.get(o.intervention_id);
    if (!iv) continue;
    const adresse = iv.acp
      ? [iv.acp.adresse, iv.acp.code_postal, iv.acp.ville].filter(Boolean).join(', ')
      : (iv.adresse ?? '');
    const pref = (o.contact_preference ?? 'email').toLowerCase() as RappelTarget['contact_preference'];
    out.push({
      intervention_id: iv.id,
      ref: iv.ref,
      creneau_debut: iv.creneau_debut,
      occupant_id: o.id,
      occupant_prenom: o.prenom,
      occupant_email: o.email,
      occupant_telephone: o.telephone,
      contact_preference: pref,
      adresse,
    });
  }
  return out;
}

// Vrai si un rappel J-1 a déjà été envoyé aujourd'hui pour cet occupant.
async function alreadySent(occupantId: string): Promise<boolean> {
  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await admin
    .from('sms_logs')
    .select('id')
    .eq('occupant_id', occupantId)
    .eq('type', 'rappel_j1')
    .gte('sent_at', today + 'T00:00:00.000Z')
    .lt('sent_at', today + 'T23:59:59.999Z')
    .limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}

async function logEmail(args: {
  intervention_id: string; occupant_id: string; to: string; message: string; ok: boolean; error?: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from('sms_logs').insert({
      intervention_id: args.intervention_id,
      occupant_id: args.occupant_id,
      to_phone: args.to,
      channel: 'email',
      type: 'rappel_j1',
      message: args.message,
      status: args.ok ? 'sent' : 'failed',
      error: args.ok ? null : args.error,
      cost_estimate_eur: 0,
    });
  } catch { /* noop */ }
}

export interface CronResult {
  sent: number;
  skipped: number;
  errors: { occupant_id: string; error: string }[];
}

export async function runRappelJ1(dryRun: boolean): Promise<{ result: CronResult; dryDetails?: Array<{ target: RappelTarget; channel: string; message: string }>}> {
  const result: CronResult = { sent: 0, skipped: 0, errors: [] };
  const dryDetails: Array<{ target: RappelTarget; channel: string; message: string }> = [];

  const targets = await listJ1Targets();
  if (targets.length === 0) return { result, dryDetails: dryRun ? [] : undefined };

  // Charge le template depuis parametres pour SMS / WhatsApp
  const admin = createAdminClient();
  const { data: tpl } = await admin
    .from('parametres')
    .select('valeur')
    .eq('cle', 'sms_template_rappel_24h')
    .maybeSingle();
  const smsTemplate = (tpl?.valeur as string | null) ??
    'Rappel FoxO : intervention demain [date] à [heure] — [adresse]. Contact : ' + VENDOR.phone;

  for (const t of targets) {
    // Dédoublonnage : pas de second rappel le même jour
    if (!dryRun && await alreadySent(t.occupant_id)) {
      result.skipped++;
      continue;
    }

    const dt = new Date(t.creneau_debut);
    const dateLabel = dt.toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' });
    const heureLabel = dt.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });

    const channels: ('email' | 'sms' | 'whatsapp')[] = (() => {
      if (t.contact_preference === 'both') return ['email', 'sms'];
      if (t.contact_preference === 'sms') return ['sms'];
      if (t.contact_preference === 'whatsapp') return ['whatsapp'];
      return ['email'];
    })();

    for (const channel of channels) {
      // Vérifie qu'on a la cible nécessaire selon le channel
      if (channel === 'email' && !t.occupant_email) { result.skipped++; continue; }
      if (channel !== 'email' && !t.occupant_telephone) { result.skipped++; continue; }

      const message = channel === 'email'
        ? `Rappel intervention FoxO demain ${dateLabel} à ${heureLabel} — ${t.adresse}`
        : applyTemplateVars(smsTemplate, {
            Prenom: t.occupant_prenom ?? '',
            date: dateLabel,
            heure: heureLabel,
            adresse: t.adresse,
            lien: '',
          });

      if (dryRun) {
        dryDetails.push({ target: t, channel, message });
        result.sent++;
        continue;
      }

      try {
        if (channel === 'email') {
          const r = await sendRappelJ1Email({
            to: t.occupant_email!,
            prenom: t.occupant_prenom,
            date: dateLabel,
            heure: heureLabel,
            adresse: t.adresse,
            ref: t.ref,
          });
          await logEmail({
            intervention_id: t.intervention_id,
            occupant_id: t.occupant_id,
            to: t.occupant_email!,
            message,
            ok: r.ok,
            error: r.ok ? undefined : r.error,
          });
          if (r.ok) result.sent++;
          else result.errors.push({ occupant_id: t.occupant_id, error: r.error });
        } else {
          const r = channel === 'whatsapp'
            ? await sendWhatsApp(t.occupant_telephone!, message)
            : await sendSMS(t.occupant_telephone!, message);
          await logSmsSend({
            intervention_id: t.intervention_id,
            occupant_id: t.occupant_id,
            to_phone: t.occupant_telephone!,
            channel,
            message,
            result: r,
            sent_by: 'cron:rappel_j1',
          });
          // Surcharge le type sur le log qu'on vient d'écrire
          await admin.from('sms_logs')
            .update({ type: 'rappel_j1' })
            .eq('occupant_id', t.occupant_id)
            .eq('channel', channel)
            .gte('sent_at', new Date(Date.now() - 30000).toISOString());
          if (r.ok) result.sent++;
          else result.errors.push({ occupant_id: t.occupant_id, error: r.error });
        }
      } catch (e) {
        result.errors.push({ occupant_id: t.occupant_id, error: e instanceof Error ? e.message : 'unknown' });
      }
    }
  }

  return { result, dryDetails: dryRun ? dryDetails : undefined };
}
