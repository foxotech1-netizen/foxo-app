import { redirect } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { getCurrentSyndic } from '@/lib/portal/syndic';
import { vocabFor, type OrgType } from '@/lib/portal/vocab';
import { PortalProvider } from './PortalContext';
import { PortalNav } from './PortalNav';

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getCurrentSyndic();
  if (!session) redirect('/auth/login');
  const { user, org } = session;

  // Type d'organisation : par défaut syndic (rétro-compat avec org sans type)
  const orgType: OrgType = org?.type === 'courtier' ? 'courtier' : 'syndic';
  const vocab = vocabFor(orgType);

  return (
    <PortalProvider
      orgType={orgType}
      orgNom={org?.nom ?? ''}
      orgEmail={user.email ?? ''}
    >
      <div className="min-h-screen bg-sand flex flex-col">
        {/* Bannière logo — sticky sur mobile pour rester visible au scroll */}
        <header
          className="border-b border-[rgba(0,0,0,0.12)] py-5 px-4 flex flex-col items-center gap-2 sticky top-0 z-40"
          style={{ background: 'var(--sidebar-logo-bg)' }}
        >
          <Logo size={72} variant="black" priority />
          <div
            className="text-[10px] uppercase tracking-[.15em] font-semibold"
            style={{ color: 'var(--sidebar-logo-fg)' }}
          >
            {vocab.portalLabel}
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
    </PortalProvider>
  );
}
