import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { roleForUserId } from '@/lib/auth/server';
import { Logo } from '@/components/Logo';
import { PWARegister } from '@/components/PWARegister';
import { TechBottomNav } from './TechBottomNav';

export const metadata: Metadata = {
  title: 'FoxO Tech',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'FoxO Tech',
    statusBarStyle: 'black-translucent',
  },
};

export const viewport: Viewport = {
  // Chrome PWA Android aligné sur le haut du dégradé sombre (--tech-bg-1).
  // Hex dupliqué à regret : la metadata Next ne peut pas lire une var CSS.
  themeColor: '#152B4E',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default async function TechLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');
  // Accès tech basé sur le rôle DB (utilisateurs.role = 'technicien'), pas une
  // whitelist d'emails. Espace tech-only : les admins ne sont pas routés ici.
  if ((await roleForUserId(user.id)) !== 'tech') {
    redirect('/auth/login?error=forbidden');
  }

  // Ping de présence — non-bloquant. Met à jour last_seen_at à chaque
  // page-load /tech pour calculer l'indicateur "en ligne" côté admin.
  if (user.email) {
    void supabase
      .from('utilisateurs')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('email', user.email);
  }

  return (
    // Thème sombre portail tech : fond marine dégradé plein écran
    // (.tech-dark-bg, globals.css). Les pages pas encore refondues en
    // sombre reçoivent automatiquement une feuille claire transitoire via
    // .tech-main (cf. globals.css) — pas de restyling page par page ici.
    <div className="min-h-screen flex flex-col tech-dark-bg">
      {/* Bannière logo — gradient navy FoxO fixe (post-migration mono-thème). */}
      <header
        className="px-4 h-16 flex items-center justify-between sticky top-0 z-50 border-b border-[rgba(255,255,255,0.08)]"
        style={{ background: 'linear-gradient(180deg, var(--color-navy-dark) 0%, var(--color-navy-deep) 100%)' }}
      >
        <Link href="/tech" className="flex items-center gap-2.5">
          {/* Logo BLANC sur fond navy permanent. */}
          <Logo size={36} variant="blanc" priority />
          <div>
            <div className="text-[10px] uppercase tracking-[.15em] font-semibold" style={{ color: 'rgba(253, 251, 247, 0.55)' }}>
              Technicien
            </div>
          </div>
        </Link>
        <div className="flex items-center gap-2">
          <form action="/auth/logout" method="POST">
            <button
              type="submit"
              className="text-[11px] px-2 min-h-[44px]"
              style={{ color: 'rgba(253, 251, 247, 0.65)' }}
            >
              Déconnexion
            </button>
          </form>
        </div>
      </header>
      {/* Conteneur de page — remplace MainContentTech (fond sable posé en
          style inline, incompatible avec le thème sombre). Même gabarit :
          640px centré, padding réservant la TechBottomNav. */}
      <main className="tech-main mx-auto w-full max-w-[640px] flex-1">
        {children}
      </main>
      <TechBottomNav />
      <PWARegister />
    </div>
  );
}
