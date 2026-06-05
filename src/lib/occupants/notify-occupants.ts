// Cœur réutilisable de l'envoi de demande de confirmation occupant.
//
// Extrait depuis la route POST /api/admin/interventions/[id]/notify-occupants
// pour être appelable hors contexte HTTP (ex. juste après création d'une
// intervention dans confirm-and-create — branchement prévu dans une étape
// ultérieure, PAS ici).
//
// Comportement préservé À L'IDENTIQUE par rapport à la route d'origine :
//   - chargement des occupants du dossier via createAdminClient ;
//   - réutilisation du confirmation_token existant, sinon génération via
//     randomBytes(16).toString('hex') ;
//   - envoi email / SMS / WhatsApp selon contact_preference ;
//   - template SMS chargé depuis la table parametres ;
//   - URL du lien construite telle quelle (NEXT_PUBLIC_APP_URL ?? app.foxo.be) —
//     l'incohérence app.foxo.be / portal.foxo.be n'est PAS corrigée ici ;
//   - token_sent_at = now() uniquement si au moins un canal a réussi.

import { randomBytes } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmailResend } from '@/lib/email/resend';
import { sendSMS, sendWhatsApp, logSmsSend, applyTemplateVars } from '@/lib/sms';
import type { ContactPreference, Intervention, ParticulierContact } from '@/lib/types/database';

interface OccupantRow {
  id: string;
  appartement: string | null;
  prenom: string | null;
  nom: string | null;
  email: string | null;
  telephone: string | null;
  contact_preference: ContactPreference | null;
  confirmation_token: string | null;
}

export interface NotifyOccupantChannelResult {
  occupant_id: string;
  channel: 'email' | 'sms' | 'whatsapp';
  ok: boolean;
  error?: string;
}

export interface NotifyOccupantsOptions {
  // Sous-ensemble d'occupants à notifier. Si omis, tous les occupants du
  // dossier sont notifiés.
  occupantIds?: string[];
  // Tracé dans sms_logs.sent_by. Défaut 'admin' (comme la route d'origine
  // quand l'email de l'utilisateur est absent).
  sentBy?: string | null;
}

export type NotifyOccupantsResult =
  | { ok: true; sent: number; failed: number; results: NotifyOccupantChannelResult[] }
  // status : code HTTP que la route doit reproduire pour ne pas casser le
  // contrat de l'UI.
  | { ok: false; error: string; status: number };

function newToken(): string {
  return randomBytes(16).toString('hex');
}

function buildEmailHtml(args: {
  prenom: string;
  date: string;
  heure: string;
  adresse: string;
  lien: string;
}): string {
  return `<!DOCTYPE html><html><body style="margin:0;background:#F5F2EC;font-family:'DM Sans',Arial,sans-serif;color:#1C1A16">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F2EC;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FDFBF7;border-radius:16px;border:1px solid #DDD8CC;padding:32px">
        <tr><td>
          <div style="font-size:24px;font-weight:800;color:#1B3A6B;letter-spacing:.02em">FoxO</div>
          <div style="font-size:11px;color:#A09A8E;text-transform:uppercase;letter-spacing:.1em;margin-top:2px">Confirmation d'intervention</div>
          <div style="height:1px;background:#DDD8CC;margin:24px 0"></div>
          <p style="font-size:14px;color:#6B6558;line-height:1.6;margin:0 0 16px">Bonjour ${args.prenom || ''},</p>
          <p style="font-size:14px;color:#1C1A16;line-height:1.6;margin:0 0 16px">
            Votre intervention FoxO est prévue le <strong>${args.date}</strong> à <strong>${args.heure}</strong> au <strong>${args.adresse}</strong>.
          </p>
          <p style="font-size:14px;color:#6B6558;line-height:1.6;margin:0 0 24px">
            Merci de cliquer sur le lien ci-dessous pour confirmer votre présence ou signaler que vous serez absent :
          </p>
          <div style="text-align:center;margin:24px 0">
            <a href="${args.lien}" style="display:inline-block;background:#1B3A6B;color:#FFFFFF;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;font-size:14px">
              Confirmer ma présence
            </a>
          </div>
          <p style="font-size:13px;color:#6B6558;line-height:1.6;margin:20px 0 0">
            Si le bouton ne marche pas, copiez ce lien dans votre navigateur :<br/>
            <a href="${args.lien}" style="color:#1B3A6B;word-break:break-all;font-family:'DM Mono',monospace;font-size:12px">${args.lien}</a>
          </p>
          <div style="height:1px;background:#DDD8CC;margin:24px 0"></div>
          <p style="font-size:11px;color:#A09A8E;line-height:1.6;margin:0">Fox Group SRL — Détection de fuites non destructive — Belgique</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * Envoie la demande de confirmation aux occupants d'une intervention.
 * Conçu pour être appelable hors contexte HTTP (utilise createAdminClient).
 *
 * @param interventionId  id du dossier
 * @param options         sous-ensemble d'occupants + traçabilité sms_logs
 */
export async function notifyOccupantsForIntervention(
  interventionId: string,
  options?: NotifyOccupantsOptions,
): Promise<NotifyOccupantsResult> {
  const admin = createAdminClient();

  // Charge intervention + occupants ciblés. Le filtre .in() n'est appliqué
  // que si un sous-ensemble est fourni (sinon tous les occupants du dossier).
  const occupantIds = options?.occupantIds;
  let occupantsQuery = admin
    .from('occupants')
    .select('id, appartement, prenom, nom, email, telephone, contact_preference, confirmation_token')
    .eq('intervention_id', interventionId);
  if (occupantIds && occupantIds.length > 0) {
    occupantsQuery = occupantsQuery.in('id', occupantIds);
  }

  const [{ data: iv, error: ivErr }, { data: occs, error: occErr }] = await Promise.all([
    admin.from('interventions').select('*').eq('id', interventionId).maybeSingle(),
    occupantsQuery,
  ]);
  if (ivErr) return { ok: false, error: ivErr.message, status: 500 };
  if (!iv) return { ok: false, error: 'Intervention introuvable.', status: 404 };
  if (occErr) return { ok: false, error: occErr.message, status: 500 };
  const occupants = (occs ?? []) as OccupantRow[];
  if (occupants.length === 0) {
    return { ok: false, error: 'Aucun occupant trouvé.', status: 404 };
  }

  const intervention = iv as Intervention;
  const pc = intervention.particulier_contact as ParticulierContact | null;
  const adresseStr = intervention.adresse
    ?? (pc?.adresse ? [pc.adresse.rue, pc.adresse.code_postal, pc.adresse.ville].filter(Boolean).join(', ') : '');

  if (!intervention.creneau_debut) {
    return { ok: false, error: 'Aucun créneau défini sur cette intervention.', status: 400 };
  }
  const creneauDate = new Date(intervention.creneau_debut);
  const dateFr = creneauDate.toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' });
  const heureFr = creneauDate.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.foxo.be';

  // Charge le template SMS
  const { data: tplRow } = await admin
    .from('parametres')
    .select('valeur')
    .eq('cle', 'sms_template_confirmation')
    .maybeSingle();
  const smsTemplate = (tplRow?.valeur as string | null)
    ?? 'Bonjour [Prénom], FoxO interviendra le [date] à [heure] pour [adresse]. Confirmez votre présence : [lien]';

  const results: NotifyOccupantChannelResult[] = [];
  const sentBy = options?.sentBy ?? 'admin';

  for (const o of occupants) {
    // Choisit le canal — défaut email si rien
    const pref: ContactPreference = o.contact_preference ?? 'email';

    // Génère/réutilise le token + met à jour token_sent_at
    let token = o.confirmation_token;
    if (!token) {
      token = newToken();
      await admin
        .from('occupants')
        .update({ confirmation_token: token })
        .eq('id', o.id);
    }
    const lien = `${baseUrl.replace(/\/$/, '')}/o/${token}`;
    const prenom = o.prenom ?? '';

    // Notes : pour 'both', on envoie email + sms ; pour 'email/sms/whatsapp'
    // on prend le canal indiqué.
    const channels: ('email' | 'sms' | 'whatsapp')[] =
      pref === 'both' ? ['email', 'sms']
      : pref === 'email' ? ['email']
      : pref === 'sms' ? ['sms']
      : ['whatsapp'];

    for (const ch of channels) {
      try {
        if (ch === 'email') {
          if (!o.email) {
            results.push({ occupant_id: o.id, channel: 'email', ok: false, error: 'Email manquant' });
            continue;
          }
          const html = buildEmailHtml({ prenom, date: dateFr, heure: heureFr, adresse: adresseStr, lien });
          const send = await sendEmailResend({
            to: o.email,
            subject: 'FoxO — Confirmation de votre intervention',
            html,
          });
          results.push({
            occupant_id: o.id, channel: 'email',
            ok: send.ok,
            error: send.ok ? undefined : send.error,
          });
        } else {
          if (!o.telephone) {
            results.push({ occupant_id: o.id, channel: ch, ok: false, error: 'Téléphone manquant' });
            continue;
          }
          const message = applyTemplateVars(smsTemplate, {
            Prenom: prenom, date: dateFr, heure: heureFr, adresse: adresseStr, lien,
          });
          const result = ch === 'whatsapp'
            ? await sendWhatsApp(o.telephone, message)
            : await sendSMS(o.telephone, message);
          await logSmsSend({
            intervention_id: interventionId,
            occupant_id: o.id,
            to_phone: o.telephone,
            channel: ch,
            message,
            result,
            sent_by: sentBy,
          });
          results.push({
            occupant_id: o.id, channel: ch,
            ok: result.ok,
            error: result.ok ? undefined : result.error,
          });
        }
      } catch (e) {
        results.push({
          occupant_id: o.id, channel: ch,
          ok: false,
          error: e instanceof Error ? e.message : 'Erreur inconnue',
        });
      }
    }

    // Marque token_sent_at si au moins un canal a réussi pour cet occupant
    const anyOk = results.filter((r) => r.occupant_id === o.id).some((r) => r.ok);
    if (anyOk) {
      await admin
        .from('occupants')
        .update({ token_sent_at: new Date().toISOString() })
        .eq('id', o.id);
    }
  }

  const sent = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  return { ok: true, sent, failed, results };
}
