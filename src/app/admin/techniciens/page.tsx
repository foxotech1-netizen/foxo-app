import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from "@/lib/auth/server";
import type { Utilisateur } from '@/lib/types/database';
import { TechniciensClient } from './TechniciensClient';

export const dynamic = 'force-dynamic';

export default async function TechniciensPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Le layout admin garantit déjà l'accès, mais on log un warning en cas
  // de désynchro (ex: sessions exotiques).
  if (!user || !(await isAdminUser())) {
    console.warn('[admin/techniciens] désynchro auth détectée — layout admin aurait dû filtrer.');
  }

  const { data, error } = await supabase
    .from('utilisateurs')
    .select('*')
    .eq('role', 'technicien')
    .order('actif', { ascending: false })
    .order('prenom', { ascending: true });

  return (
    <TechniciensClient
      initial={(data ?? []) as Utilisateur[]}
      loadError={error?.message ?? null}
    />
  );
}
