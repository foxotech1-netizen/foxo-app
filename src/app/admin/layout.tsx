import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from "@/lib/auth/server";
import Sidebar from '@components/Sidebar';
import { MainContent } from '@components/layout/MainContent';
import { getValidationTotal } from '@/lib/admin/validation-queue';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/auth/login');
  if (!(await isAdminUser())) {
    redirect('/auth/login?error=forbidden');
  }

  const cutoff48h = new Date(Date.now() - 48 * 3600_000).toISOString();
  const [ivsRes, recentRespRes, validationCount] = await Promise.all([
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
    // Compteur de la file de validation (5 sources) — module partagé.
    getValidationTotal(supabase),
  ]);

  const ivs = ivsRes.data ?? [];
  const alertCount = ivs.filter(
    (i) => i.statut === 'en_suspens' || (i.statut === 'nouvelle' && !i.technicien_id),
  ).length;
  const recentResponsesCount = recentRespRes.count ?? 0;

  return (
    <div className="flex min-h-screen">
      <Sidebar alertCount={alertCount} recentResponsesCount={recentResponsesCount} validationCount={validationCount} />
      {/* Right column en flex-col : topbar (sticky) + MainContent (Design
          System FoxO — sand bg + radial gradients). Le `<main>` sémantique
          est porté par MainContent, donc cette div extérieure reste un
          simple wrapper. */}
      <div className="flex-1 flex flex-col min-w-0">
        <MainContent className="flex-1">{children}</MainContent>
      </div>
    </div>
  );
}
