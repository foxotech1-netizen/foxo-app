import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';
import { exchangeCodeForTokens, saveTokens } from '@/lib/google-auth';

// Construit la redirection finale vers /admin/parametres en restant
// sur le host courant (celui où l'utilisateur a démarré le flow OAuth).
function paramsRedirect(request: Request, success: boolean, msg?: string) {
  const reqUrl = new URL(request.url);
  const url = new URL('/admin/parametres', `${reqUrl.protocol}//${reqUrl.host}`);
  url.searchParams.set('google', success ? 'ok' : 'err');
  if (msg) url.searchParams.set('msg', msg.slice(0, 200));
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return paramsRedirect(request, false, 'Accès refusé.');
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) return paramsRedirect(request, false, `Google : ${error}`);
  if (!code) return paramsRedirect(request, false, 'Code manquant.');

  // CSRF check — le cookie a été posé par /api/google/auth sur LE MÊME host
  const cookieStore = await cookies();
  const stored = cookieStore.get('foxo_google_oauth_state')?.value;
  if (!state || !stored || state !== stored) {
    return paramsRedirect(request, false, 'État CSRF invalide.');
  }

  // Le redirect_uri envoyé à Google /token DOIT être identique à celui
  // utilisé dans /authorize → reconstruit depuis le host courant.
  const redirectUri = `${url.protocol}//${url.host}/api/google/callback`;

  const exchange = await exchangeCodeForTokens(code, redirectUri);
  if (!exchange.ok) return paramsRedirect(request, false, exchange.error);

  const save = await saveTokens({
    access_token: exchange.access_token,
    refresh_token: exchange.refresh_token,
    expiry: exchange.expiry,
    scope: exchange.scope,
    email: exchange.email,
  });
  if (!save.ok) return paramsRedirect(request, false, save.error);

  // Cleanup state cookie
  const res = paramsRedirect(request, true);
  res.cookies.delete('foxo_google_oauth_state');
  return res;
}
