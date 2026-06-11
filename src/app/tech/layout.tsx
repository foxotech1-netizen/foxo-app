import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { roleForUserId } from '@/lib/auth/server';
import { Logo } from '@/components/Logo';
import { PWARegister } from '@/components/PWARegister';
import { MainContentTech } from '@components/layout/MainContentTech';
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
  themeColor: '#1B3A6B',
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
    <div className="min-h-screen flex flex-col bg-sand text-ink">
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
      <MainContentTech>{children}</MainContentTech>
      <TechBottomNav />
      <PWARegister />
    </div>
  );
}
