import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail, TECH_EMAILS } from '@/lib/auth/roles';
import type { Utilisateur } from '@/lib/types/database';
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

  const [ivsRes, techsRes] = await Promise.all([
    supabase.from('interventions').select('statut, technicien_id').is('deleted_at', null),
    supabase
      .from('utilisateurs')
      .select('id, prenom, nom, email')
      .in('email', TECH_EMAILS as unknown as string[])
      .order('prenom', { ascending: true }),
  ]);

  const alertCount = (ivsRes.data ?? []).filter(
    (i) => i.statut === 'en_suspens' || (i.statut === 'nouvelle' && !i.technicien_id),
  ).length;

  const techs = (techsRes.data ?? []) as Utilisateur[];

  return (
    <div className="flex bg-sand min-h-screen">
      <Sidebar alertCount={alertCount} techs={techs} />
      <main className="flex-1 flex flex-col min-w-0">{children}</main>
    </div>
  );
}
