import { redirect } from 'next/navigation';
import { getCurrentSyndic } from '@/lib/portal/syndic';
import { type OrgType } from '@/lib/portal/vocab';
import { MainContent } from '@components/layout/MainContent';
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

  // Type d'organisation : par défaut syndic (rétro-compat avec org sans type).
  // Étendu pour supporter expert (lecture seule, pas de création de demande).
  const orgType: OrgType =
    org?.type === 'courtier' ? 'courtier' :
    org?.type === 'expert'   ? 'expert'   :
    'syndic';

  return (
    <PortalProvider
      orgType={orgType}
      orgNom={org?.nom ?? ''}
      orgEmail={user.email ?? ''}
    >
      {/* Layout flex calqué sur src/app/admin/layout.tsx :
          - PortalNav rend la sidebar desktop (sticky 220px) + mobile header
            fixe en haut + bottom nav iOS-style (4 items).
          - MainContent porte le `<main>` sémantique + sand bg + radial
            gradients du Design System FoxO. Le padding interne (px-6 py-6)
            est géré par MainContent ; les pages refondues (Phase 1+)
            géreront elles-mêmes leur max-width et leur padding mobile. */}
      <div className="flex min-h-screen">
        <PortalNav />
        <MainContent className="flex-1 min-w-0">{children}</MainContent>
      </div>
    </PortalProvider>
  );
}
