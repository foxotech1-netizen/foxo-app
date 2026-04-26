import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { PortalNav } from './PortalNav';

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  return (
    <div className="min-h-screen bg-sand flex flex-col">
      {/* Bannière logo */}
      <header
        className="border-b border-[rgba(0,0,0,0.12)] py-5 px-4 flex flex-col items-center gap-2"
        style={{ background: 'var(--sidebar-logo-bg)' }}
      >
        <Logo size={72} priority />
        <div
          className="text-[10px] uppercase tracking-[.15em] font-semibold"
          style={{ color: 'var(--sidebar-logo-fg)' }}
        >
          Portail Syndic
        </div>
      </header>

      <PortalNav />

      {/* Bandeau utilisateur compact */}
      <div className="bg-cream border-b border-sand-border">
        <div className="max-w-[1100px] mx-auto px-3 sm:px-6 py-2 flex items-center justify-end gap-3">
          <span className="text-[11px] text-ink-muted truncate">{user.email}</span>
          <ThemeToggle className="text-[14px] w-7 h-7 rounded-md hover:bg-sand-mid flex items-center justify-center" />
          <form action="/auth/logout" method="POST">
            <button
              type="submit"
              className="text-[11px] text-ink-mid hover:text-ink underline-offset-2 hover:underline"
            >
              Déconnexion
            </button>
          </form>
        </div>
      </div>

      <main className="flex-1 px-3 sm:px-6 py-5 max-w-[1100px] mx-auto w-full">
        {children}
      </main>
    </div>
  );
}
