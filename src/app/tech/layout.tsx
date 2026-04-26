import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';
import { Logo } from '@/components/Logo';
import { PWARegister } from '@/components/PWARegister';
import { ThemeToggle } from '@/components/ThemeToggle';

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
  if (roleForEmail(user.email) !== 'tech') {
    redirect('/auth/login?error=forbidden');
  }

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--tech-bg)', color: 'var(--tech-text)' }}
    >
      <header
        className="px-4 h-14 flex items-center justify-between sticky top-0 z-50"
        style={{
          background: 'var(--tech-card)',
          borderBottom: '1px solid var(--tech-border)',
        }}
      >
        <Link href="/tech" className="flex items-center gap-2.5">
          <Logo size={32} priority />
          <div>
            <div
              className="text-[15px] font-extrabold leading-none"
              style={{ color: 'var(--tech-text)' }}
            >FoxO</div>
            <div
              className="text-[9px] uppercase tracking-widest font-bold mt-0.5"
              style={{ color: 'var(--tech-text-mute)' }}
            >Technicien</div>
          </div>
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle
            className="w-8 h-8 rounded-md flex items-center justify-center text-[14px]"
          />
          <form action="/auth/logout" method="POST">
            <button
              type="submit"
              className="text-[11px] px-2 hover:opacity-80"
              style={{ color: 'var(--tech-text-mute)' }}
            >
              Déconnexion
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 px-4 py-4 max-w-[640px] mx-auto w-full pb-20">
        {children}
      </main>
      <PWARegister />
    </div>
  );
}
