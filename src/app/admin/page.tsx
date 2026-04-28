import { createClient } from '@/lib/supabase/server';
import { TECH_EMAILS } from '@/lib/auth/roles';
import type { Acp, Intervention, Organisation, Utilisateur, InterventionRow } from '@/lib/types/database';
import { InterventionsClient } from './InterventionsClient';

export const dynamic = 'force-dynamic';

type AcpLite = Pick<Acp, 'id' | 'nom' | 'adresse' | 'ville'>;

export default async function AdminPipelinePage() {
  const supabase = await createClient();

  const [interventionsRes, acpsRes, orgsRes, usersRes] = await Promise.all([
    supabase
      .from('interventions')
      .select('*')
      .order('created_at', { ascending: false }),
    supabase.from('acps').select('id,nom,adresse,ville'),
    supabase.from('organisations').select('id,nom,type,email'),
    supabase
      .from('utilisateurs')
      .select('id,prenom,nom,email')
      .in('email', TECH_EMAILS as unknown as string[]),
  ]);

  if (interventionsRes.error) {
    console.warn('[admin] interventions query error:', interventionsRes.error.message);
  }

  const interventions: Intervention[] = interventionsRes.data ?? [];
  const acps: AcpLite[] = (acpsRes.data as AcpLite[] | null) ?? [];
  const orgs: Pick<Organisation, 'id' | 'nom' | 'type' | 'email'>[] = orgsRes.data ?? [];
  const techs: Utilisateur[] = usersRes.data ?? [];

  const acpMap = new Map(acps.map((a) => [a.id, a]));
  const orgMap = new Map(orgs.map((o) => [o.id, o]));
  const techMap = new Map(techs.map((t) => [t.id, t]));

  const rows: InterventionRow[] = interventions.map((iv) => ({
    ...iv,
    acp: iv.acp_id ? (acpMap.get(iv.acp_id) ?? null) : null,
    syndic: iv.syndic_id ? (orgMap.get(iv.syndic_id) ?? null) : null,
    technicien: iv.technicien_id ? (techMap.get(iv.technicien_id) ?? null) : null,
  }));

  return (
    <InterventionsClient
      initialRows={rows}
      techs={techs}
      loadError={interventionsRes.error?.message ?? null}
    />
  );
}
