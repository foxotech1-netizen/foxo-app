import { Resend } from 'resend';
import { VENDOR, VENDOR_BILLING_FROM } from '@/lib/constants/vendor';

export type SendResult = { ok: true; id: string } | { ok: false; error: string };

interface RappelJ1Args {
  to: string;
  prenom: string | null;
  date: string;       // ex : "vendredi 30 mai"
  heure: string;      // ex : "09h00"
  adresse: string;    // adresse intervention
  ref: string | null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c
  ));
}

export async function sendRappelJ1Email(args: RappelJ1Args): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY absente.' };

  const resend = new Resend(apiKey);
  const prenomTxt = args.prenom ? args.prenom : '';
  const refTxt = args.ref ? ` (réf. ${args.ref})` : '';
  const subject = `Rappel : intervention FoxO demain ${args.date}`;

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#F5F2EC;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#FDFBF7;border:1px solid #DDD8CC;border-radius:12px;overflow:hidden">
    <div style="background:#E2C9A1;padding:18px 24px;text-align:center">
      <div style="font-size:18px;font-weight:800;color:#2C2A24">FoxO</div>
      <div style="font-size:10px;color:#7A6A50;text-transform:uppercase;letter-spacing:.18em;margin-top:2px">Rappel d'intervention</div>
    </div>
    <div style="padding:24px">
      <p style="font-size:14px;color:#1C1A16;margin:0 0 12px">Bonjour ${escapeHtml(prenomTxt)},</p>
      <p style="font-size:14px;color:#1C1A16;line-height:1.5;margin:0 0 16px">
        Petit rappel : votre intervention FoxO${escapeHtml(refTxt)} est prévue
        <strong>demain ${escapeHtml(args.date)} à ${escapeHtml(args.heure)}</strong>.
      </p>
      <div style="background:#F5F2EC;border-left:3px solid #1B3A6B;padding:12px 14px;margin:0 0 16px;border-radius:4px">
        <div style="font-size:11px;color:#6B6558;text-transform:uppercase;letter-spacing:.05em;font-weight:700">Adresse</div>
        <div style="font-size:13px;color:#1C1A16;margin-top:4px">${escapeHtml(args.adresse)}</div>
      </div>
      <p style="font-size:13px;color:#6B6558;line-height:1.5;margin:0 0 8px">
        Merci de garantir l'accès à l'eau et aux pièces concernées.
      </p>
      <p style="font-size:13px;color:#6B6558;line-height:1.5;margin:0">
        Une question ? <a href="tel:${VENDOR.phone.replace(/\s/g, '')}" style="color:#1B3A6B;text-decoration:none">${VENDOR.phone}</a>
        ou <a href="mailto:${VENDOR.email}" style="color:#1B3A6B;text-decoration:none">${VENDOR.email}</a>.
      </p>
    </div>
    <div style="background:#EDE8DF;padding:14px 24px;text-align:center">
      <div style="font-size:11px;color:#A09A8E">${escapeHtml(VENDOR.name)} · BCE ${escapeHtml(VENDOR.bce)}</div>
    </div>
  </div>
</body>
</html>`;

  try {
    const res = await resend.emails.send({
      from: VENDOR_BILLING_FROM,
      to: [args.to],
      subject,
      html,
      text: `Bonjour ${prenomTxt}, rappel : intervention FoxO demain ${args.date} à ${args.heure}, ${args.adresse}. Info : ${VENDOR.phone}`,
    });
    if (res.error) return { ok: false, error: res.error.message };
    return { ok: true, id: res.data?.id ?? '' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur Resend.' };
  }
}
