import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { roleForEmail } from '@/lib/auth/roles';
import { sendEmail } from '@/lib/gmail';
import { sendSMS, sendWhatsApp, logSmsSend, applyTemplateVars } from '@/lib/sms';
import type { ContactPreference, Intervention, ParticulierContact } from '@/lib/types/database';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface PostBody {
  occupant_ids?: unknown;            // requis — sous-ensemble des occupants à notifier
}

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

interface NotifyResult {
  occupant_id: string;
  channel: 'email' | 'sms' | 'whatsapp';
  ok: boolean;
  error?: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { id } = await params;

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }
  const occupantIds = Array.isArray(body.occupant_ids)
    ? body.occupant_ids.filter((x): x is string => typeof x === 'string')
    : [];
  if (occupantIds.length === 0) {
    return NextResponse.json({ ok: false, error: 'Aucun occupant fourni.' }, { status: 400 });
  }

  // Charge intervention + occupants ciblés
  const [{ data: iv, error: ivErr }, { data: occs, error: occErr }] = await Promise.all([
    supabase.from('interventions').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('occupants')
      .select('id, appartement, prenom, nom, email, telephone, contact_preference, confirmation_token')
      .eq('intervention_id', id)
      .in('id', occupantIds),
  ]);
  if (ivErr) return NextResponse.json({ ok: false, error: ivErr.message }, { status: 500 });
  if (!iv) return NextResponse.json({ ok: false, error: 'Intervention introuvable.' }, { status: 404 });
  if (occErr) return NextResponse.json({ ok: false, error: occErr.message }, { status: 500 });
  const occupants = (occs ?? []) as OccupantRow[];
  if (occupants.length === 0) {
    return NextResponse.json({ ok: false, error: 'Aucun occupant trouvé.' }, { status: 404 });
  }

  const intervention = iv as Intervention;
  const pc = intervention.particulier_contact as ParticulierContact | null;
  const adresseStr = intervention.adresse
    ?? (pc?.adresse ? [pc.adresse.rue, pc.adresse.code_postal, pc.adresse.ville].filter(Boolean).join(', ') : '');

  if (!intervention.creneau_debut) {
    return NextResponse.json({ ok: false, error: 'Aucun créneau défini sur cette intervention.' }, { status: 400 });
  }
  const creneauDate = new Date(intervention.creneau_debut);
  const dateFr = creneauDate.toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' });
  const heureFr = creneauDate.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.foxo.be';
  const admin = createAdminClient();

  // Charge le template SMS
  const { data: tplRow } = await supabase
    .from('parametres')
    .select('valeur')
    .eq('cle', 'sms_template_confirmation')
    .maybeSingle();
  const smsTemplate = (tplRow?.valeur as string | null)
    ?? 'Bonjour [Prénom], FoxO interviendra le [date] à [heure] pour [adresse]. Confirmez votre présence : [lien]';

  const results: NotifyResult[] = [];
  const sentBy = user.email ?? 'admin';

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
          const send = await sendEmail({
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
            intervention_id: id,
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
  return NextResponse.json({ ok: true, sent, failed, results });
}
