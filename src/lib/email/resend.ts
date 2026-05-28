import { Resend } from 'resend';
import { RESEND_FROM_EMAIL } from '@/lib/constants/vendor';

export type SendResult = { ok: true; id: string } | { ok: false; error: string };

export interface SendEmailResendArgs {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

/**
 * Envoi transactionnel via Resend (domaine send.foxo.be).
 * Contrat identique à sendEmail (Gmail) pour migration drop-in.
 */
export async function sendEmailResend(args: SendEmailResendArgs): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'RESEND_API_KEY absente' };
  }

  const resend = new Resend(apiKey);
  const from = args.from ?? RESEND_FROM_EMAIL;

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: [args.to],
      subject: args.subject,
      html: args.html,
      ...(args.text ? { text: args.text } : {}),
    });

    if (error) {
      return { ok: false, error: error.message ?? String(error) };
    }
    if (!data?.id) {
      return { ok: false, error: 'Resend: réponse sans id' };
    }
    return { ok: true, id: data.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
