import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';
import { buildAuthUrl, googleConfigured } from '@/lib/google-auth';

// Lance l'authent Google : guard admin + redirection vers le consent screen.
//
// `redirect_uri` est dérivé du host de la requête (et NON de NEXT_PUBLIC_APP_URL)
// pour que le flow OAuth reste sur le même sous-domaine de bout en bout.
// Sinon le cookie CSRF set ici (admin.foxo.be) est invisible quand Google
// rappelle un AUTRE host (app.foxo.be) → "État CSRF invalide".
//
// Chaque host autorisé doit être déclaré dans Google Cloud Console :
//   https://admin.foxo.be/api/google/callback
//   https://app.foxo.be/api/google/callback   (legacy, pour compat)
//   http://localhost:3000/api/google/callback (dev)
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 });
  }
  if (!googleConfigured()) {
    return NextResponse.json({ error: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET manquant.' }, { status: 500 });
  }

  const reqUrl = new URL(request.url);
  const redirectUri = `${reqUrl.protocol}//${reqUrl.host}/api/google/callback`;

  // CSRF state — vérifié côté callback via cookie (même host garanti)
  const state = randomBytes(16).toString('hex');
  const url = buildAuthUrl(state, redirectUri);

  const res = NextResponse.redirect(url);
  res.cookies.set('foxo_google_oauth_state', state, {
    httpOnly: true,
    secure: reqUrl.protocol === 'https:',   // false en dev (localhost http)
    sameSite: 'lax',
    path: '/',
    maxAge: 600,    // 10 minutes
  });
  return res;
}
