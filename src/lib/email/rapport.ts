import { Resend } from 'resend';

export type SendRapportArgs = {
  to: string;
  acpNom: string;
  ref: string;
  syndicNom: string | null;
  technicienNom: string | null;
  pdfBuffer: Buffer;
};

export type SendResult = { ok: true; id?: string } | { ok: false; error: string };

function buildHtml(args: SendRapportArgs): string {
  return `<!DOCTYPE html><html><body style="margin:0;background:#F5F2EC;font-family:'DM Sans',Arial,sans-serif;color:#1C1A16">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F2EC;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FDFBF7;border-radius:16px;border:1px solid #DDD8CC;padding:28px 28px 24px">
        <tr><td>
          <div style="font-size:24px;font-weight:800;color:#1B3A6B;letter-spacing:.02em">FoxO</div>
          <div style="font-size:11px;color:#A09A8E;text-transform:uppercase;letter-spacing:.1em;margin-top:2px">Rapport d'intervention</div>
          <div style="height:1px;background:#DDD8CC;margin:20px 0"></div>
          <p style="font-size:14px;color:#1C1A16;line-height:1.6;margin:0 0 12px">Bonjour${args.syndicNom ? ' ' + escapeHtml(args.syndicNom) : ''},</p>
          <p style="font-size:14px;color:#6B6558;line-height:1.65;margin:0 0 14px">
            Le rapport de l'intervention <strong style="font-family:'DM Mono',monospace;color:#1B3A6B">${escapeHtml(args.ref)}</strong> à <strong>${escapeHtml(args.acpNom)}</strong> est disponible.
            Vous le trouverez en pièce jointe.
          </p>
          ${args.technicienNom ? `<p style="font-size:13px;color:#6B6558;line-height:1.65;margin:0 0 14px">Technicien intervenant : <strong>${escapeHtml(args.technicienNom)}</strong>.</p>` : ''}
          <p style="font-size:13px;color:#6B6558;line-height:1.65;margin:0 0 16px">
            Vous pouvez également retrouver le détail dans votre portail syndic :
            <a href="https://portal.foxo.be" style="color:#1B3A6B">portal.foxo.be</a>.
          </p>
          <div style="height:1px;background:#DDD8CC;margin:20px 0"></div>
          <p style="font-size:11px;color:#A09A8E;line-height:1.6;margin:0">Fox Group SRL — Détection de fuites non destructive — Belgique<br>noreply@send.foxo.be</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));
}

export async function sendRapportEmail(args: SendRapportArgs): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY non configurée.' };

  const resend = new Resend(apiKey);
  const from = process.env.RESEND_FROM_EMAIL ?? 'FoxO <noreply@foxo.be>';

  const { data, error } = await resend.emails.send({
    from,
    to: [args.to],
    subject: `Rapport d'intervention — ${args.acpNom} (${args.ref})`,
    html: buildHtml(args),
    attachments: [
      {
        filename: `rapport-${args.ref}.pdf`,
        content: args.pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });

  if (error) {
    console.error('[email/rapport] Resend error:', error);
    return { ok: false, error: error.message ?? 'send failed' };
  }
  return { ok: true, id: data?.id };
}
