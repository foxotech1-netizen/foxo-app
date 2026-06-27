import { redirect } from 'next/navigation';
import { getCurrentSyndic } from '@/lib/portal/syndic';
import { type OrgType } from '@/lib/portal/vocab';
import { cookies } from 'next/headers';
import { normalizeLang, PORTAL_LANG_COOKIE } from '@/lib/portal/i18n';
import { createClient } from '@/lib/supabase/server';
import { MainContent } from '@components/layout/MainContent';
import { PortalProvider } from './PortalContext';
import { PortalNav } from './PortalNav';
import { type PortalNotification } from './NotificationBell';

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getCurrentSyndic();
  if (!session) redirect('/auth/login');
  const { user, org } = session;

  // Type d'organisation : par défaut syndic (rétro-compat avec org sans type).
  // Étendu pour courtier et expert — ces deux partagent le vocabulaire
  // "dossier sinistre / assuré" et peuvent créer une demande (cf. submitRequest,
  // branche isExpert qui assouplit la référence compagnie).
  const orgType: OrgType =
    org?.type === 'courtier' ? 'courtier' :
    org?.type === 'expert'   ? 'expert'   :
    'syndic';

  // Langue du portail : cookie portal_lang (fr|nl|en), defaut fr. Lue cote
  // serveur pour un rendu SSR directement dans la bonne langue (pas de flash).
  const cookieStore = await cookies();
  const lang = normalizeLang(cookieStore.get(PORTAL_LANG_COOKIE)?.value);

  // Notifications non lues du partenaire connecté. Best-effort : tout échec
  // (table absente, RLS, etc.) laisse une cloche vide sans casser le rendu.
  let notifications: PortalNotification[] = [];
  let unreadCount = 0;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id) {
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('destinataire_id', user.id)
        .eq('lu', false);
      unreadCount = count ?? 0;

      const { data } = await supabase
        .from('notifications')
        .select('id, titre, message, lien, created_at')
        .eq('destinataire_id', user.id)
        .eq('lu', false)
        .order('created_at', { ascending: false })
        .limit(10);
      notifications = (data ?? []) as PortalNotification[];
    }
  } catch (e) {
    console.error('[portal/layout] notifications KO:', e instanceof Error ? e.message : e);
  }

  return (
    <PortalProvider
      orgType={orgType}
      orgNom={org?.nom ?? ''}
      orgEmail={user.email ?? ''}
      lang={lang}
    >
      {/* Layout flex calqué sur src/app/admin/layout.tsx :
          - PortalNav rend la sidebar desktop (sticky 220px) + mobile header
            fixe en haut + bottom nav iOS-style (4 items).
          - MainContent porte le `<main>` sémantique + sand bg + radial
            gradients du Design System FoxO. Le padding interne (px-6 py-6)
            est géré par MainContent ; les pages refondues (Phase 1+)
            géreront elles-mêmes leur max-width et leur padding mobile. */}
      <div className="flex min-h-screen">
        <PortalNav notifications={notifications} unreadCount={unreadCount} />
        <MainContent className="flex-1 min-w-0">{children}</MainContent>
      </div>
    </PortalProvider>
  );
}
