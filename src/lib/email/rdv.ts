import { Resend } from 'resend';
import { VENDOR } from '@/lib/constants/vendor';

const ADMIN_NOTIF_EMAIL = 'info@foxo.be';

export type RdvEmailData = {
  ref: string;
  prenom: string;
  nom: string;
  email: string;
  telephone: string;
  adresse: string;          // ligne formatée "{rue}, {cp} {ville}"
  type: string;
  description: string;
  priorite: 'normale' | 'urgente';
  creneauIso: string | null;
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!),
  );
}

function fmtCreneau(iso: string | null): string {
  if (!iso) return 'À définir avec FoxO';
  const d = new Date(iso);
  return d.toLocaleString('fr-BE', {
    weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit',
  });
}

function buildClientHtml(d: RdvEmailData): string {
  return `<!DOCTYPE html><html><body style="margin:0;background:#F5F2EC;font-family:'DM Sans',Arial,sans-serif;color:#1C1A16">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F2EC;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#FDFBF7;border-radius:16px;border:1px solid #DDD8CC;padding:28px">
        <tr><td>
          <div style="font-size:24px;font-weight:800;color:#1B3A6B;letter-spacing:.02em">FoxO</div>
          <div style="font-size:11px;color:#A09A8E;text-transform:uppercase;letter-spacing:.1em;margin-top:2px">Demande reçue</div>
          <div style="height:1px;background:#DDD8CC;margin:20px 0"></div>

          <p style="font-size:14px;color:#1C1A16;line-height:1.6;margin:0 0 12px">Bonjour ${escapeHtml(d.prenom)},</p>
          <p style="font-size:14px;color:#6B6558;line-height:1.6;margin:0 0 14px">
            Votre demande d'intervention est bien arrivée chez nous. Nous vous confirmons un créneau sous <strong>24h ouvrables</strong>.
          </p>

          <table cellpadding="0" cellspacing="0" style="width:100%;background:#F5F2EC;border-radius:8px;padding:14px;border:1px solid #DDD8CC;margin-bottom:14px">
            <tr><td>
              <div style="font-size:9px;color:#A09A8E;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px">Référence</div>
              <div style="font-size:14px;font-weight:700;color:#1B3A6B;font-family:'DM Mono',monospace">${escapeHtml(d.ref)}</div>
            </td></tr>
          </table>

          <table cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;color:#1C1A16;margin-bottom:14px">
            <tr><td style="padding:4px 0;color:#A09A8E;width:120px">Type</td><td>${escapeHtml(d.type)}</td></tr>
            <tr><td style="padding:4px 0;color:#A09A8E">Adresse</td><td>${escapeHtml(d.adresse)}</td></tr>
            <tr><td style="padding:4px 0;color:#A09A8E">Priorité</td><td>${d.priorite === 'urgente' ? '<span style="color:#C4622D;font-weight:700">⚡ Urgente</span>' : 'Normale'}</td></tr>
            <tr><td style="padding:4px 0;color:#A09A8E">Créneau souhaité</td><td>${escapeHtml(fmtCreneau(d.creneauIso))}</td></tr>
          </table>

          ${d.description ? `<div style="background:#EBF2FB;border-radius:8px;padding:12px;font-size:13px;color:#1C1A16;line-height:1.5;margin-bottom:14px"><div style="font-size:9px;color:#1B3A6B;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px;font-weight:700">Description</div>${escapeHtml(d.description)}</div>` : ''}

          <p style="font-size:12px;color:#6B6558;line-height:1.6;margin:0 0 12px">
            Si vous avez la moindre question, contactez-nous : <a href="tel:${VENDOR.phone.replace(/\s/g,'')}" style="color:#1B3A6B">${escapeHtml(VENDOR.phone)}</a> · <a href="mailto:${VENDOR.email}" style="color:#1B3A6B">${escapeHtml(VENDOR.email)}</a>
          </p>

          <div style="height:1px;background:#DDD8CC;margin:20px 0"></div>
          <p style="font-size:11px;color:#A09A8E;line-height:1.6;margin:0">
            ${escapeHtml(VENDOR.name)} — ${escapeHtml(VENDOR.addressLine1)}, ${escapeHtml(VENDOR.addressLine2)}<br>
            BCE ${escapeHtml(VENDOR.bce)} · TVA ${escapeHtml(VENDOR.vat)}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function buildAdminHtml(d: RdvEmailData): string {
  return `<!DOCTYPE html><html><body style="margin:0;background:#F5F2EC;font-family:'DM Sans',Arial,sans-serif;color:#1C1A16">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F2EC;padding:24px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FDFBF7;border-radius:12px;border:1px solid #DDD8CC;padding:24px">
        <tr><td>
          <div style="font-size:11px;color:#A09A8E;text-transform:uppercase;letter-spacing:.1em">Nouvelle demande particulier</div>
          <div style="font-size:20px;font-weight:800;color:#1B3A6B;margin-top:6px;font-family:'DM Mono',monospace">${escapeHtml(d.ref)}</div>
          <div style="height:1px;background:#DDD8CC;margin:16px 0"></div>

          <table cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;color:#1C1A16">
            <tr><td style="padding:5px 0;color:#A09A8E;width:130px">Demandeur</td><td><strong>${escapeHtml(d.prenom)} ${escapeHtml(d.nom)}</strong></td></tr>
            <tr><td style="padding:5px 0;color:#A09A8E">Email</td><td><a href="mailto:${escapeHtml(d.email)}" style="color:#1B3A6B">${escapeHtml(d.email)}</a></td></tr>
            <tr><td style="padding:5px 0;color:#A09A8E">Téléphone</td><td><a href="tel:${escapeHtml(d.telephone)}" style="color:#1B3A6B">${escapeHtml(d.telephone)}</a></td></tr>
            <tr><td style="padding:5px 0;color:#A09A8E">Adresse</td><td>${escapeHtml(d.adresse)}</td></tr>
            <tr><td style="padding:5px 0;color:#A09A8E">Type</td><td>${escapeHtml(d.type)}</td></tr>
            <tr><td style="padding:5px 0;color:#A09A8E">Priorité</td><td>${d.priorite === 'urgente' ? '<strong style="color:#C4622D">⚡ URGENTE</strong>' : 'Normale'}</td></tr>
            <tr><td style="padding:5px 0;color:#A09A8E">Créneau souhaité</td><td>${escapeHtml(fmtCreneau(d.creneauIso))}</td></tr>
          </table>

          ${d.description ? `<div style="background:#F5F2EC;border-radius:8px;padding:12px;font-size:13px;color:#1C1A16;line-height:1.5;margin-top:14px"><div style="font-size:9px;color:#A09A8E;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px;font-weight:700">Description</div>${escapeHtml(d.description)}</div>` : ''}

          <a href="https://admin.foxo.be" style="display:inline-block;margin-top:18px;background:#1B3A6B;color:#fff;padding:10px 18px;border-radius:8px;font-size:12px;font-weight:700;text-decoration:none">Voir dans l'admin</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

type SendResult = { ok: true; id?: string } | { ok: false; error: string };

async function sendOne(args: {
  to: string;
  subject: string;
  html: string;
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY absente' };

  const resend = new Resend(apiKey);
  const from = process.env.RESEND_FROM_EMAIL ?? 'FoxO <noreply@foxo.be>';

  const { data, error } = await resend.emails.send({
    from,
    to: [args.to],
    subject: args.subject,
    html: args.html,
  });
  if (error) return { ok: false, error: error.message ?? 'send failed' };
  return { ok: true, id: data?.id };
}

export async function sendRdvConfirmation(d: RdvEmailData): Promise<SendResult> {
  return sendOne({
    to: d.email,
    subject: 'FoxO — Votre demande a bien été reçue',
    html: buildClientHtml(d),
  });
}

export async function sendRdvAdminNotification(d: RdvEmailData): Promise<SendResult> {
  const subject = `Nouvelle demande particulier — ${d.prenom} ${d.nom} — ${d.adresse} — ${d.type}`;
  return sendOne({
    to: ADMIN_NOTIF_EMAIL,
    subject,
    html: buildAdminHtml(d),
  });
}
