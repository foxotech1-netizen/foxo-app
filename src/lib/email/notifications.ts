import { fmtDateTime } from '@/lib/format';
import { sendEmailResend } from '@/lib/email/resend';
import { createAdminClient } from '@/lib/supabase/admin';
import { VENDOR } from '@/lib/constants/vendor';
import { getEmailForDoc } from '@/lib/notifications';
import type { StatutIntervention } from '@/lib/types/database';

const ADMIN_NOTIF_EMAIL = 'info@foxo.be';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));
}

function buildHeader(title: string): string {
  return `<div style="font-size:20px;font-weight:800;color:#1B3A6B;letter-spacing:.02em">FoxO</div>
<div style="font-size:11px;color:#A09A8E;text-transform:uppercase;letter-spacing:.1em;margin-top:2px">${escapeHtml(title)}</div>
<div style="height:1px;background:#DDD8CC;margin:16px 0"></div>`;
}

function buildShell(inner: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;background:#F5F2EC;font-family:'DM Sans',Arial,sans-serif;color:#1C1A16">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F2EC;padding:32px 16px">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#FDFBF7;border-radius:12px;border:1px solid #DDD8CC;padding:24px">
      <tr><td>${inner}</td></tr>
    </table>
  </td></tr>
</table></body></html>`;
}

async function sendOne(args: { to: string; subject: string; html: string; attachments?: Array<{ filename: string; content: Buffer; contentType?: string }> }): Promise<boolean> {
  const send = await sendEmailResend({
    to: args.to,
    subject: args.subject,
    html: args.html,
    attachments: args.attachments,
  });
  if (!send.ok) {
    console.warn('[notifications] Resend error:', send.error);
    return false;
  }
  return true;
}

// ── Charge le contexte minimal d'une intervention ──────────────────

type Context = {
  iv: {
    id: string;
    ref: string | null;
    type: string | null;
    description: string | null;
    creneau_debut: string | null;
    adresse: string | null;
    statut: StatutIntervention;
    particulier_contact: { email: string | null } | null;
  };
  acp: {
    nom: string;
    email_facturation: string | null;
    email_rapport: string | null;
    email_factures: string | null;
    email_rapports: string | null;
    email_communications: string | null;
  } | null;
  acpNom: string | null;
  syndic: {
    nom: string;
    email: string;
    email_factures: string | null;
    email_rapports: string | null;
    email_communications: string | null;
  } | null;
  syndicNom: string | null;
  syndicEmail: string | null;
  occupants: { id: string; nom: string | null; email: string | null; appartement: string | null; confirmation_token: string | null }[];
};

async function loadContext(interventionId: string): Promise<Context | null> {
  const admin = (() => {
    try { return createAdminClient(); } catch { return null; }
  })();
  if (!admin) return null;

  const { data: iv } = await admin
    .from('interventions')
    .select('id, ref, type, description, creneau_debut, adresse, statut, acp_id, syndic_id, particulier_contact')
    .eq('id', interventionId)
    .maybeSingle();
  if (!iv) return null;

  const [acpRes, orgRes, occRes] = await Promise.all([
    iv.acp_id
      ? admin.from('acps').select('nom, email_facturation, email_rapport, email_factures, email_rapports, email_communications').eq('id', iv.acp_id).maybeSingle()
      : Promise.resolve({ data: null }),
    iv.syndic_id
      ? admin.from('organisations').select('nom, email, email_factures, email_rapports, email_communications').eq('id', iv.syndic_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from('occupants').select('id, nom, email, appartement, confirmation_token').eq('intervention_id', iv.id),
  ]);

  type AcpEmails = {
    nom: string;
    email_facturation: string | null;
    email_rapport: string | null;
    email_factures: string | null;
    email_rapports: string | null;
    email_communications: string | null;
  };
  type SyndicEmails = {
    nom: string;
    email: string;
    email_factures: string | null;
    email_rapports: string | null;
    email_communications: string | null;
  };
  const acp = acpRes.data as AcpEmails | null;
  const syndic = orgRes.data as SyndicEmails | null;

  return {
    iv: {
      id: iv.id,
      ref: iv.ref,
      type: iv.type,
      description: iv.description,
      creneau_debut: iv.creneau_debut,
      adresse: iv.adresse,
      statut: iv.statut as StatutIntervention,
      particulier_contact: iv.particulier_contact as { email: string | null } | null,
    },
    acp,
    acpNom: acp?.nom ?? null,
    syndic,
    syndicNom: syndic?.nom ?? null,
    syndicEmail: syndic?.email ?? null,
    occupants: (occRes.data ?? []) as Context['occupants'],
  };
}

function fmtCreneau(iso: string | null): string {
  if (!iso) return 'À définir';
  return fmtDateTime(iso, true);
}

// ── Notifications par statut ───────────────────────────────────────

async function notifyNouvelle(ctx: Context): Promise<void> {
  const html = buildShell(
    buildHeader('Nouvelle intervention créée') +
    `<p style="font-size:14px;line-height:1.6;margin:0 0 12px">Une intervention vient d'être créée.</p>
     <table cellpadding="0" cellspacing="0" style="font-size:13px;width:100%;margin-bottom:14px">
      <tr><td style="padding:5px 0;color:#A09A8E;width:130px">Référence</td><td><strong style="font-family:'DM Mono',monospace">${escapeHtml(ctx.iv.ref ?? '—')}</strong></td></tr>
      <tr><td style="padding:5px 0;color:#A09A8E">Type</td><td>${escapeHtml(ctx.iv.type ?? '—')}</td></tr>
      <tr><td style="padding:5px 0;color:#A09A8E">${ctx.acpNom ? 'ACP / Assuré' : 'Adresse'}</td><td>${escapeHtml(ctx.acpNom ?? ctx.iv.adresse ?? '—')}</td></tr>
      <tr><td style="padding:5px 0;color:#A09A8E">Demandeur</td><td>${escapeHtml(ctx.syndicNom ?? '—')}</td></tr>
     </table>
     <a href="https://admin.foxo.be" style="display:inline-block;background:#1B3A6B;color:#fff;padding:10px 18px;border-radius:8px;font-size:12px;font-weight:700;text-decoration:none">Voir dans l'admin</a>`
  );
  await sendOne({
    to: ADMIN_NOTIF_EMAIL,
    subject: `Nouvelle intervention — ${ctx.iv.ref ?? ctx.iv.id} — ${ctx.acpNom ?? ctx.iv.adresse ?? ''}`,
    html,
  });
}

async function notifyConfirmee(ctx: Context): Promise<void> {
  // Destinataire résolu via la cascade ACP → Syndic → ... — type 'communication'
  const recipient = getEmailForDoc(
    { acp: ctx.acp, syndic: ctx.syndic, particulier_contact: ctx.iv.particulier_contact },
    'communication',
  );
  if (recipient.email) {
    const html = buildShell(
      buildHeader('Intervention confirmée') +
      `<p style="font-size:14px;line-height:1.6;margin:0 0 12px">Bonjour${ctx.syndicNom ? ' ' + escapeHtml(ctx.syndicNom) : ''},</p>
       <p style="font-size:14px;color:#6B6558;line-height:1.6;margin:0 0 14px">L'intervention <strong style="font-family:'DM Mono',monospace;color:#1B3A6B">${escapeHtml(ctx.iv.ref ?? '—')}</strong> à ${escapeHtml(ctx.acpNom ?? ctx.iv.adresse ?? '—')} est confirmée pour le <strong>${escapeHtml(fmtCreneau(ctx.iv.creneau_debut))}</strong>.</p>
       <p style="font-size:13px;color:#6B6558;line-height:1.6">Détails dans votre portail : <a href="https://portal.foxo.be" style="color:#1B3A6B">portal.foxo.be</a></p>`
    );
    await sendOne({
      to: recipient.email,
      subject: `Intervention confirmée — ${ctx.acpNom ?? ctx.iv.adresse ?? ''} (${ctx.iv.ref ?? ''})`,
      html,
    });
  }

  // Emails occupants avec leur lien personnel
  for (const occ of ctx.occupants) {
    if (!occ.email) continue;
    if (!occ.confirmation_token) {
      console.warn('[notifications] occupant sans confirmation_token, lien non envoyé:', occ.id);
      continue;
    }
    const link = `https://portal.foxo.be/o/${occ.confirmation_token}`;
    const html = buildShell(
      buildHeader('Confirmation de présence') +
      `<p style="font-size:14px;line-height:1.6;margin:0 0 12px">Bonjour${occ.nom ? ' ' + escapeHtml(occ.nom) : ''},</p>
       <p style="font-size:14px;color:#6B6558;line-height:1.6;margin:0 0 14px">Une intervention de détection de fuites est prévue à votre adresse${occ.appartement ? ` (apt. ${escapeHtml(occ.appartement)})` : ''} le <strong>${escapeHtml(fmtCreneau(ctx.iv.creneau_debut))}</strong>.</p>
       <p style="font-size:14px;color:#6B6558;line-height:1.6;margin:0 0 18px">Merci de confirmer votre présence en cliquant ci-dessous :</p>
       <a href="${link}" style="display:inline-block;background:#1B3A6B;color:#fff;padding:12px 22px;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none">Confirmer ma présence</a>`
    );
    await sendOne({
      to: occ.email,
      subject: `Intervention FoxO le ${fmtCreneau(ctx.iv.creneau_debut)} — confirmation`,
      html,
    });
  }
}

async function notifyCloturee(ctx: Context): Promise<void> {
  // Cloturée = facture en attachment → on adresse à l'email factures
  // (avec cascade ACP → Syndic → legacy → fallback).
  const recipient = getEmailForDoc(
    { acp: ctx.acp, syndic: ctx.syndic, particulier_contact: ctx.iv.particulier_contact },
    'facture',
  );
  if (!recipient.email) return;

  // Tente d'attacher la facture si elle existe
  let attachments: Array<{ filename: string; content: Buffer; contentType?: string }> | undefined;
  try {
    const admin = createAdminClient();
    const { data: blob } = await admin.storage
      .from('invoices')
      .download(`${ctx.iv.id}.pdf`);
    if (blob) {
      const buf = Buffer.from(await blob.arrayBuffer());
      attachments = [{ filename: `facture-${ctx.iv.ref ?? ctx.iv.id}.pdf`, content: buf }];
    }
  } catch {
    // pas grave, email sans pj
  }

  const html = buildShell(
    buildHeader('Intervention clôturée') +
    `<p style="font-size:14px;line-height:1.6;margin:0 0 12px">Bonjour${ctx.syndicNom ? ' ' + escapeHtml(ctx.syndicNom) : ''},</p>
     <p style="font-size:14px;color:#6B6558;line-height:1.6;margin:0 0 14px">L'intervention <strong style="font-family:'DM Mono',monospace;color:#1B3A6B">${escapeHtml(ctx.iv.ref ?? '—')}</strong> est clôturée${attachments ? '. La facture est en pièce jointe.' : '.'}</p>
     <p style="font-size:13px;color:#6B6558;line-height:1.6">Récapitulatif complet : <a href="https://portal.foxo.be" style="color:#1B3A6B">portal.foxo.be</a></p>
     <div style="height:1px;background:#DDD8CC;margin:18px 0"></div>
     <p style="font-size:11px;color:#A09A8E;line-height:1.6;margin:0">${escapeHtml(VENDOR.name)} · ${escapeHtml(VENDOR.email)}</p>`
  );
  await sendOne({
    to: recipient.email,
    subject: `Intervention clôturée — ${ctx.acpNom ?? ctx.iv.adresse ?? ''} (${ctx.iv.ref ?? ''})`,
    html,
    attachments,
  });
}

// ── Dispatcher principal ───────────────────────────────────────────

export async function notifyStatusChange(
  interventionId: string,
  newStatut: StatutIntervention,
): Promise<void> {
  const ctx = await loadContext(interventionId);
  if (!ctx) return;

  switch (newStatut) {
    case 'nouvelle':
      await notifyNouvelle(ctx);
      break;
    case 'confirmee':
      await notifyConfirmee(ctx);
      break;
    case 'cloturee':
      await notifyCloturee(ctx);
      break;
    default:
      // Pas de notification automatique pour : attente, realisee, rapport,
      // en_suspens. La TRANSMISSION du rapport au syndic ne se fait QUE via les
      // chemins explicites (bouton admin « Envoyer au syndic » →
      // resendRapportToSyndic, ou action assistant transmettre_rapport), après
      // validation. On ne déclenche plus dispatchRapportToSyndic ici (audit
      // sécurité 2026-06-10) : un simple passage en statut « rapport »
      // (publication tech ou upload PDF admin) ne notifie plus le syndic.
      break;
  }
}
