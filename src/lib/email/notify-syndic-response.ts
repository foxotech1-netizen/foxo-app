// Notifie le syndic (ou le destinataire 'communication' en cascade) lorsqu'un
// occupant a répondu à un lien de confirmation. Utilise Gmail (sendEmail), à
// la différence du flux Resend de `lib/email/notifications.ts` qui sert au
// dispatcher de changements de statut.
//
// Le helper est strictement best-effort : il n'échoue jamais (return en cas
// de problème, log via console.warn). Les Server Actions appelantes ne
// doivent pas dépendre de son résultat.

import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmailResend } from '@/lib/email/resend';
import { getEmailForDoc } from '@/lib/notifications';
import type {
  Acp,
  Intervention,
  Occupant,
  Organisation,
  ParticulierContact,
} from '@/lib/types/database';

type Reponse = 'confirme' | 'decline' | 'counter';

const REPONSE_LIBELLE: Record<Reponse, string> = {
  confirme: 'présence confirmée',
  decline: 'ne sera pas présent',
  counter: 'propose un autre créneau',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]!));
}

function fmtCreneau(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-BE', {
    weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit',
  });
}

function buildHtml(args: {
  ref: string;
  acpNom: string;
  acpAdresse: string;
  occupantNom: string;
  occupantAppt: string;
  reponseLibelle: string;
  reponseTon: 'ok' | 'terra' | 'navy';
  creneauInitial: string;
  creneauPropose: string | null;
  note: string | null;
}): string {
  const accent = args.reponseTon === 'ok' ? '#1F6B45'
    : args.reponseTon === 'terra' ? '#C4622D'
    : '#1B3A6B';

  const counterBlock = args.creneauPropose
    ? `<tr>
         <td style="padding:6px 0;color:#A09A8E;width:160px">Créneau proposé</td>
         <td style="font-weight:700;color:${accent}">${escapeHtml(args.creneauPropose)}</td>
       </tr>`
    : '';

  const noteBlock = args.note
    ? `<div style="margin-top:14px;padding:12px 14px;background:#F5F2EC;border-left:3px solid ${accent};border-radius:4px">
         <div style="font-size:10px;color:#A09A8E;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:4px">Commentaire de l'occupant</div>
         <div style="font-size:13px;color:#1C1A16;line-height:1.5;white-space:pre-wrap">${escapeHtml(args.note)}</div>
       </div>`
    : '';

  return `<!DOCTYPE html><html><body style="margin:0;background:#F5F2EC;font-family:'DM Sans',Arial,sans-serif;color:#1C1A16">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F2EC;padding:32px 16px">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#FDFBF7;border-radius:12px;border:1px solid #DDD8CC;padding:28px">
      <tr><td>
        <div style="font-size:20px;font-weight:800;color:#1B3A6B;letter-spacing:.02em">FoxO</div>
        <div style="font-size:11px;color:#A09A8E;text-transform:uppercase;letter-spacing:.1em;margin-top:2px">Réponse d'un occupant</div>
        <div style="height:1px;background:#DDD8CC;margin:18px 0"></div>
        <p style="font-size:14px;color:#1C1A16;line-height:1.6;margin:0 0 14px">
          L'occupant <strong>${escapeHtml(args.occupantNom || 'Occupant')}</strong>${args.occupantAppt ? ` (apt. <strong>${escapeHtml(args.occupantAppt)}</strong>)` : ''} a indiqué&nbsp;:
          <span style="color:${accent};font-weight:700">${escapeHtml(args.reponseLibelle)}</span>.
        </p>
        <table cellpadding="0" cellspacing="0" style="font-size:13px;width:100%;margin:8px 0 6px">
          <tr><td style="padding:6px 0;color:#A09A8E;width:160px">Référence</td><td><strong style="font-family:'DM Mono',monospace">${escapeHtml(args.ref)}</strong></td></tr>
          <tr><td style="padding:6px 0;color:#A09A8E">ACP / Immeuble</td><td>${escapeHtml(args.acpNom)}</td></tr>
          ${args.acpAdresse ? `<tr><td style="padding:6px 0;color:#A09A8E">Adresse</td><td>${escapeHtml(args.acpAdresse)}</td></tr>` : ''}
          <tr><td style="padding:6px 0;color:#A09A8E">Créneau initial</td><td>${escapeHtml(args.creneauInitial)}</td></tr>
          ${counterBlock}
        </table>
        ${noteBlock}
        <div style="margin-top:22px">
          <a href="https://admin.foxo.be" style="display:inline-block;background:#1B3A6B;color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none">Voir dans l'admin</a>
        </div>
        <div style="height:1px;background:#DDD8CC;margin:22px 0 14px"></div>
        <p style="font-size:11px;color:#A09A8E;line-height:1.6;margin:0">Fox Group SRL — Détection de fuites non destructive — Belgique</p>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;
}

export async function notifySyndicOccupantResponse(args: {
  interventionId: string;
  occupantId: string;
  reponse: Reponse;
  proposedDebut: string | null;
  proposedFin: string | null;
  note: string | null;
}): Promise<void> {
  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    console.warn('[notify-syndic-response] admin client indisponible:', e);
    return;
  }

  // Charge en parallèle l'occupant + l'intervention
  const [occRes, ivRes] = await Promise.all([
    admin
      .from('occupants')
      .select('id, prenom, nom, appartement, intervention_id')
      .eq('id', args.occupantId)
      .maybeSingle(),
    admin
      .from('interventions')
      .select('id, ref, creneau_debut, acp_id, syndic_id, particulier_contact')
      .eq('id', args.interventionId)
      .maybeSingle(),
  ]);

  const occ = occRes.data as Pick<Occupant, 'id' | 'prenom' | 'nom' | 'appartement' | 'intervention_id'> | null;
  const iv = ivRes.data as Pick<Intervention,
    'id' | 'ref' | 'creneau_debut' | 'acp_id' | 'syndic_id' | 'particulier_contact'> | null;

  if (!occ || !iv) {
    console.warn('[notify-syndic-response] occupant ou intervention introuvable.');
    return;
  }

  const [acpRes, synRes] = await Promise.all([
    iv.acp_id
      ? admin.from('acps')
          .select('nom, adresse, ville, code_postal, email_communications, email_factures, email_rapports, email_facturation, email_rapport')
          .eq('id', iv.acp_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    iv.syndic_id
      ? admin.from('organisations')
          .select('nom, email, email_communications, email_factures, email_rapports')
          .eq('id', iv.syndic_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  type AcpEmails = Pick<Acp, 'nom' | 'adresse' | 'ville' | 'code_postal' | 'email_communications' | 'email_factures' | 'email_rapports' | 'email_facturation' | 'email_rapport'>;
  type SyndicEmails = Pick<Organisation, 'nom' | 'email' | 'email_communications' | 'email_factures' | 'email_rapports'>;
  const acp = (acpRes.data as AcpEmails | null) ?? null;
  const syndic = (synRes.data as SyndicEmails | null) ?? null;

  const recipient = getEmailForDoc(
    {
      acp,
      syndic,
      particulier_contact: iv.particulier_contact as ParticulierContact | null,
    },
    'communication',
  );

  if (!recipient.email) {
    console.warn('[notify-syndic-response] aucun email destinataire (communication) pour intervention', iv.id);
    return;
  }

  const occupantNom = [occ.prenom, occ.nom].filter(Boolean).join(' ').trim();
  const occupantAppt = occ.appartement ?? '';
  const ref = iv.ref ?? iv.id;
  const acpNom = acp?.nom ?? '—';
  const acpAdresse = [acp?.adresse, acp?.code_postal, acp?.ville].filter(Boolean).join(', ');

  const reponseTon: 'ok' | 'terra' | 'navy' =
    args.reponse === 'confirme' ? 'ok'
    : args.reponse === 'decline' ? 'terra'
    : 'navy';

  const subject = `[FoxO] Occupant ${occupantAppt || occupantNom || ''} — ${REPONSE_LIBELLE[args.reponse]} — ${ref}`;

  const html = buildHtml({
    ref,
    acpNom,
    acpAdresse,
    occupantNom,
    occupantAppt,
    reponseLibelle: REPONSE_LIBELLE[args.reponse],
    reponseTon,
    creneauInitial: fmtCreneau(iv.creneau_debut),
    creneauPropose: args.reponse === 'counter' && args.proposedDebut
      ? `${fmtCreneau(args.proposedDebut)}${args.proposedFin ? ` → ${fmtCreneau(args.proposedFin)}` : ''}`
      : null,
    note: args.note,
  });

  try {
    const r = await sendEmailResend({ to: recipient.email, subject, html });
    if (!r.ok) {
      console.warn('[notify-syndic-response] sendEmail KO:', r.error);
    }
  } catch (e) {
    console.warn('[notify-syndic-response] sendEmail throw:', e);
  }
}
