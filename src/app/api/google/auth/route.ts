import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from "@/lib/auth/server";
import { buildAuthUrl, googleConfigured, saveOAuthState } from '@/lib/google-auth';

// Lance l'authent Google : guard admin + persiste le state CSRF en DB
// + redirige vers le consent screen.
//
// State stocké en DB (parametres.google_oauth_state_<state>) plutôt qu'en
// cookie pour éviter les soucis de cross-subdomain : peu importe que
// l'utilisateur démarre sur admin.foxo.be et que Google rappelle un
// autre host, la vérif côté callback est purement DB → host-agnostique.
//
// `redirect_uri` reste dérivé du host de la requête (sinon Google rejette
// avec redirect_uri_mismatch). Chaque host autorisé doit être déclaré
// dans Google Cloud Console.
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 });
  }
  if (!googleConfigured()) {
    return NextResponse.json({ error: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET manquant.' }, { status: 500 });
  }

  const reqUrl = new URL(request.url);
  const redirectUri = `${reqUrl.protocol}//${reqUrl.host}/api/google/callback`;

  const state = randomBytes(16).toString('hex');
  const saved = await saveOAuthState(state);
  if (!saved.ok) {
    return NextResponse.json({ error: `État CSRF non persistable : ${saved.error}` }, { status: 500 });
  }

  const url = buildAuthUrl(state, redirectUri);
  return NextResponse.redirect(url);
}
