import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';
import Sidebar from '@components/Sidebar';
import { ThemeToggle } from '@/components/ThemeToggle';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/auth/login');
  if (roleForEmail(user.email) !== 'admin') {
    redirect('/auth/login?error=forbidden');
  }

  const cutoff48h = new Date(Date.now() - 48 * 3600_000).toISOString();
  const [ivsRes, recentRespRes] = await Promise.all([
    supabase
      .from('interventions')
      .select('statut, technicien_id')
      .is('deleted_at', null),
    // Réponses occupants < 48h. On compte ici la borne basse ; le filtrage
    // sur le statut intervention (cloturee/realisee exclus) est fait côté
    // /admin/page.tsx pour la carte. Le badge sidebar peut sur-compter
    // marginalement, c'est acceptable (vs requête jointe coûteuse).
    supabase
      .from('occupants')
      .select('id', { count: 'exact', head: true })
      .gte('confirmed_at', cutoff48h),
  ]);

  const ivs = ivsRes.data ?? [];
  const alertCount = ivs.filter(
    (i) => i.statut === 'en_suspens' || (i.statut === 'nouvelle' && !i.technicien_id),
  ).length;
  const recentResponsesCount = recentRespRes.count ?? 0;

  return (
    <div className="flex bg-sand min-h-screen">
      <Sidebar alertCount={alertCount} recentResponsesCount={recentResponsesCount} />
      <main className="flex-1 flex flex-col min-w-0">
        {/* Topbar globale — présente sur toutes les pages admin.
            Emplacement réservé à droite : ThemeToggle pour l'instant ;
            la barre de recherche globale et le bouton "Nouvelle
            intervention" pourront s'insérer ici plus tard. */}
        <div className="flex items-center justify-end gap-2 px-4 py-2 border-b border-sand-border bg-cream flex-shrink-0 sticky top-0 z-40">
          <ThemeToggle
            inline
            className="px-2.5 py-1.5 rounded-md text-[16px] leading-none hover:bg-sand-mid transition cursor-pointer"
          />
        </div>
        {children}
      </main>
    </div>
  );
}
