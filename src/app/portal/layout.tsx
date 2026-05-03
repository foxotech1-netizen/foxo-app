import { redirect } from 'next/navigation';
import { getCurrentSyndic } from '@/lib/portal/syndic';
import { type OrgType } from '@/lib/portal/vocab';
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

  return (
    <PortalProvider
      orgType={orgType}
      orgNom={org?.nom ?? ''}
      orgEmail={user.email ?? ''}
    >
      {/* Layout flex calqué sur src/app/admin/layout.tsx :
          - PortalNav rend la sidebar desktop (sticky 220px) + mobile header
            fixe en haut + bottom nav iOS-style (4 items).
          - <main> prend le reste de la largeur via flex-1. Le padding mobile
            (top 80 + bottom 90) est ajouté par les media queries de PortalNav. */}
      <div className="flex bg-sand min-h-screen">
        <PortalNav />
        <main className="flex-1 flex flex-col min-w-0 px-3 sm:px-6 py-5 max-w-[1100px] mx-auto w-full">
          {children}
        </main>
      </div>
    </PortalProvider>
  );
}
