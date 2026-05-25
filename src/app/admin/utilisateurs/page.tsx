import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from "@/lib/auth/server";
import { UtilisateursClient, type UtilisateurRow } from './UtilisateursClient';

export const dynamic = 'force-dynamic';

// Fetch direct Supabase plutôt que round-trip HTTP vers /api/admin/utilisateurs
// (pas de cookie propagation à gérer, plus rapide). Même shape qu'expose
// la route API : utilisateurs joints à organisations + org_nom aplati.
export default async function UtilisateursPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    console.warn('[admin/utilisateurs] désynchro auth — layout admin aurait dû filtrer.');
  }

  const { data, error } = await supabase
    .from('utilisateurs')
    .select(`
      id, email, role, actif, organisation_id, telephone,
      created_at, last_seen_at,
      organisation:organisations(id, nom)
    `)
    .in('role', ['syndic', 'courtier', 'technicien'])
    .order('created_at', { ascending: false });

  // Cf. /api/admin/utilisateurs : Supabase JS type la jointure comme array.
  const initial: UtilisateurRow[] = ((data ?? []) as unknown as Array<UtilisateurRow & {
    organisation: { id: string; nom: string }[] | { id: string; nom: string } | null;
  }>).map((u) => {
    const org = Array.isArray(u.organisation) ? (u.organisation[0] ?? null) : u.organisation;
    return { ...u, organisation: org, org_nom: org?.nom ?? null };
  });

  return <UtilisateursClient initial={initial} loadError={error?.message ?? null} />;
}
