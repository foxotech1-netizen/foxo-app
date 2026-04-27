import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { roleForEmail, pathForRole } from '@/lib/auth/roles';

// Mapping sous-domaine → préfixe de route. En dev (localhost) on n'applique
// aucun rewrite : on accède directement aux paths /admin, /portal, /tech, /auth.
const SUBDOMAIN_PREFIX: Record<string, string> = {
  'admin.foxo.be':  '/admin',
  'portal.foxo.be': '/portal',
  'tech.foxo.be':   '/tech',
  'auth.foxo.be':   '/auth',
};

const KNOWN_GROUP_PATHS = Object.values(SUBDOMAIN_PREFIX);

function resolvePrefix(host: string): string | null {
  return SUBDOMAIN_PREFIX[host.toLowerCase()] ?? null;
}

// Vrai si le pathname cible déjà un groupe de routes (ex: /auth/login,
// /admin/syndics). Dans ce cas, ne pas re-préfixer même si on est sur un
// autre sous-domaine — sinon les redirections cross-app cassent.
function startsWithKnownGroup(pathname: string): boolean {
  return KNOWN_GROUP_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Bypass : assets statiques, API, fichiers Next, portail occupant public, RDV particulier
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/o/') ||           // portail occupant — public, pas d'auth
    pathname === '/rdv' || pathname.startsWith('/rdv/') || // page RDV particulier — publique
    pathname.includes('.') // .png, .ico, .svg…
  ) {
    return NextResponse.next();
  }

  const host = (request.headers.get('host') ?? '').split(':')[0];
  const prefix = resolvePrefix(host);

  // 1. Refresh de session Supabase via cookies
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 2. Calcul du chemin effectif après rewrite éventuel.
  let targetPathname = pathname;
  if (prefix && !pathname.startsWith(prefix) && !startsWithKnownGroup(pathname)) {
    if (prefix === '/auth' && pathname === '/') {
      // auth.foxo.be n'a pas de page racine — on atterrit sur le login.
      targetPathname = '/auth/login';
    } else {
      targetPathname = prefix + (pathname === '/' ? '' : pathname);
    }
  }

  if (targetPathname !== pathname) {
    const url = request.nextUrl.clone();
    url.pathname = targetPathname;
    const rewritten = NextResponse.rewrite(url, { request });
    response.cookies.getAll().forEach((c) => rewritten.cookies.set(c));
    response = rewritten;
  }

  // 3. Protection : routes /admin, /portal, /tech requièrent une session
  const isProtected =
    targetPathname.startsWith('/admin') ||
    targetPathname.startsWith('/portal') ||
    targetPathname.startsWith('/tech');

  if (isProtected && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/auth/login';
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 4. Autorisation : un user connecté hors de son périmètre est routé chez lui
  if (user) {
    const role = roleForEmail(user.email);
    const expected = role ? pathForRole(role) : null;
    if (
      expected &&
      ((targetPathname.startsWith('/admin')  && expected !== '/admin') ||
       (targetPathname.startsWith('/tech')   && expected !== '/tech')   ||
       (targetPathname.startsWith('/portal') && expected !== '/portal'))
    ) {
      const url = request.nextUrl.clone();
      url.pathname = expected;
      return NextResponse.redirect(url);
    }
    // Déjà connecté → la page de login redirige chez l'utilisateur
    if (targetPathname === '/auth/login') {
      const url = request.nextUrl.clone();
      url.pathname = expected ?? '/portal';
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: [
    // Tout sauf assets statiques
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)',
  ],
};
