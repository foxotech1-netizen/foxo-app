import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';
import { exchangeCodeForTokens, saveTokens } from '@/lib/google-auth';

function paramsRedirect(success: boolean, msg?: string) {
  const url = new URL('/admin/parametres', process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.foxo.be');
  url.searchParams.set('google', success ? 'ok' : 'err');
  if (msg) url.searchParams.set('msg', msg.slice(0, 200));
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return paramsRedirect(false, 'Accès refusé.');
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) return paramsRedirect(false, `Google : ${error}`);
  if (!code) return paramsRedirect(false, 'Code manquant.');

  // CSRF check
  const cookieStore = await cookies();
  const stored = cookieStore.get('foxo_google_oauth_state')?.value;
  if (!state || !stored || state !== stored) {
    return paramsRedirect(false, 'État CSRF invalide.');
  }

  const exchange = await exchangeCodeForTokens(code);
  if (!exchange.ok) return paramsRedirect(false, exchange.error);

  const save = await saveTokens({
    access_token: exchange.access_token,
    refresh_token: exchange.refresh_token,
    expiry: exchange.expiry,
    scope: exchange.scope,
    email: exchange.email,
  });
  if (!save.ok) return paramsRedirect(false, save.error);

  // Cleanup state cookie
  const res = paramsRedirect(true);
  res.cookies.delete('foxo_google_oauth_state');
  return res;
}
