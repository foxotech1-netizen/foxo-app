import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';
import Sidebar from '@components/Sidebar';

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

  // Compteur d'alertes : suspens + nouvelles non assignées
  const { data: ivs } = await supabase
    .from('interventions')
    .select('statut, technicien_id');
  const alertCount = (ivs ?? []).filter(
    (i) => i.statut === 'en_suspens' || (i.statut === 'nouvelle' && !i.technicien_id),
  ).length;

  return (
    <div className="flex bg-sand min-h-screen">
      <Sidebar alertCount={alertCount} />
      <main className="flex-1 flex flex-col min-w-0">{children}</main>
    </div>
  );
}
