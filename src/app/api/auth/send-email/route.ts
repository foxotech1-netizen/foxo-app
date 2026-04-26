import { NextResponse } from 'next/server';
import { Resend } from 'resend';

// Auth Hook Supabase — Send Email (Standard Webhooks)
// Configuration : Supabase Dashboard → Authentication → Hooks → Send Email Hook
//   URL    : https://auth.foxo.be/api/auth/send-email
//   Secret : généré par Supabase, à coller dans SUPABASE_AUTH_HOOK_SECRET
//
// Format du payload : { user, email_data: { token, token_hash, redirect_to,
// email_action_type, site_url, ... } }

interface HookPayload {
  user: { id: string; email: string };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type:
      | 'signup'
      | 'login'
      | 'magiclink'
      | 'recovery'
      | 'invite'
      | 'email_change_confirm_new'
      | 'email_change_confirm_old';
    site_url: string;
  };
}

const SUBJECTS: Record<HookPayload['email_data']['email_action_type'], string> = {
  signup: 'Confirme ton inscription FoxO',
  login: 'Code de connexion FoxO',
  magiclink: 'Code de connexion FoxO',
  recovery: 'Réinitialisation de ton mot de passe FoxO',
  invite: 'Invitation FoxO',
  email_change_confirm_new: 'Confirme ta nouvelle adresse email FoxO',
  email_change_confirm_old: 'Changement d\'adresse email FoxO',
};

function buildHtml(token: string, action: HookPayload['email_data']['email_action_type']): string {
  const heading = action === 'recovery'
    ? 'Réinitialisation FoxO'
    : 'Connexion FoxO';
  return `<!DOCTYPE html><html><body style="margin:0;background:#F5F2EC;font-family:'DM Sans',Arial,sans-serif;color:#1C1A16">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F2EC;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FDFBF7;border-radius:16px;border:1px solid #DDD8CC;padding:32px">
        <tr><td>
          <div style="font-size:24px;font-weight:800;color:#1B3A6B;letter-spacing:.02em">FoxO</div>
          <div style="font-size:11px;color:#A09A8E;text-transform:uppercase;letter-spacing:.1em;margin-top:2px">${heading}</div>
          <div style="height:1px;background:#DDD8CC;margin:24px 0"></div>
          <p style="font-size:14px;color:#6B6558;line-height:1.6;margin:0 0 16px">Voici votre code de connexion :</p>
          <div style="font-size:32px;font-weight:800;letter-spacing:.4em;text-align:center;background:#EBF2FB;color:#1B3A6B;padding:20px;border-radius:12px;font-family:'DM Mono',monospace">${token}</div>
          <p style="font-size:13px;color:#6B6558;line-height:1.6;margin:20px 0 0">Ce code expire dans <strong>1 heure</strong>. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
          <div style="height:1px;background:#DDD8CC;margin:24px 0"></div>
          <p style="font-size:11px;color:#A09A8E;line-height:1.6;margin:0">Fox Group SRL — Détection de fuites non destructive — Belgique</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// Vérification de signature Standard Webhooks (HMAC-SHA256).
// Format header : "v1,base64(...)" (peut contenir plusieurs versions séparées par espaces).
// Secret stocké : "v1,whsec_BASE64..."
async function verifySignature(
  rawBody: string,
  webhookId: string,
  webhookTimestamp: string,
  webhookSignature: string,
  secret: string,
): Promise<boolean> {
  // Le secret peut être préfixé "v1,whsec_" — on extrait la base64 brute
  const secretB64 = secret.replace(/^v1,/, '').replace(/^whsec_/, '');
  let secretBytes: Uint8Array;
  try {
    secretBytes = Uint8Array.from(atob(secretB64), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }

  const toSign = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(secretBytes),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(toSign));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));

  // Le header peut contenir plusieurs signatures "v1,sig1 v2,sig2"
  const sigs = webhookSignature.split(' ').map((s) => s.split(',')[1]).filter(Boolean);
  return sigs.includes(expected);
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const secret = process.env.SUPABASE_AUTH_HOOK_SECRET;

  if (secret) {
    const webhookId = request.headers.get('webhook-id') ?? '';
    const webhookTimestamp = request.headers.get('webhook-timestamp') ?? '';
    const webhookSignature = request.headers.get('webhook-signature') ?? '';
    if (!webhookId || !webhookTimestamp || !webhookSignature) {
      return NextResponse.json({ error: 'missing_signature_headers' }, { status: 401 });
    }
    const ok = await verifySignature(rawBody, webhookId, webhookTimestamp, webhookSignature, secret);
    if (!ok) {
      return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
    }
  } else {
    // Pas de secret configuré — log un warning. En prod, configure SUPABASE_AUTH_HOOK_SECRET.
    console.warn('[auth/send-email] SUPABASE_AUTH_HOOK_SECRET non configuré — webhook non signé.');
  }

  let payload: HookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { user, email_data } = payload;
  if (!user?.email || !email_data?.token) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'resend_not_configured' }, { status: 500 });
  }

  const resend = new Resend(apiKey);
  const from = process.env.RESEND_FROM_EMAIL ?? 'FoxO <noreply@foxo.be>';
  const subject = SUBJECTS[email_data.email_action_type] ?? 'Code FoxO';

  const { error } = await resend.emails.send({
    from,
    to: [user.email],
    subject,
    html: buildHtml(email_data.token, email_data.email_action_type),
  });

  if (error) {
    console.error('[auth/send-email] Resend error:', error);
    return NextResponse.json({ error: 'send_failed' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
