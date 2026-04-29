import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';
import { buildAuthUrl, googleConfigured } from '@/lib/google-auth';

// Lance l'authent Google : guard admin + redirection vers le consent screen.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 });
  }
  if (!googleConfigured()) {
    return NextResponse.json({ error: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET manquant.' }, { status: 500 });
  }

  // CSRF state — vérifié côté callback via cookie
  const state = randomBytes(16).toString('hex');
  const url = buildAuthUrl(state);

  const res = NextResponse.redirect(url);
  res.cookies.set('foxo_google_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,    // 10 minutes
  });
  return res;
}
