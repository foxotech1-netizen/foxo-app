import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentSyndic } from '@/lib/portal/syndic';
import { DossierPortalClient } from './DossierPortalClient';
import type { Acp, Intervention, Occupant, Utilisateur } from '@/lib/types/database';

export const dynamic = 'force-dynamic';

export type DossierData = {
  intervention: Intervention;
  acp: Acp | null;
  occupants: Occupant[];
  technicien: Pick<Utilisateur, 'id' | 'prenom' | 'nom'> | null;
  isCourtier: boolean;
  hasReport: boolean;
};

export default async function InterventionDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getCurrentSyndic();
  if (!session?.org) redirect('/portal/interventions');
  const { org } = session;

  const supabase = await createClient();

  // Sécurité : intervention rattachée au syndic (legacy syndic_id) OU à
  // l'org du délégué connecté (nouveau lien organisation_id). Filtre soft
  // delete pour rester aligné avec la liste.
  const { data: iv } = await supabase
    .from('interventions')
    .select('*')
    .eq('id', id)
    .or(`syndic_id.eq.${org.id},organisation_id.eq.${org.id}`)
    .is('deleted_at', null)
    .maybeSingle();

  if (!iv) redirect('/portal/interventions');
  const intervention = iv as Intervention;

  // Fetchs annexes en parallèle.
  const [acpRes, occRes, techRes] = await Promise.all([
    intervention.acp_id
      ? supabase.from('acps').select('*').eq('id', intervention.acp_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('occupants').select('*').eq('intervention_id', intervention.id),
    intervention.technicien_id
      ? supabase.from('utilisateurs').select('id, prenom, nom').eq('id', intervention.technicien_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const data: DossierData = {
    intervention,
    acp: (acpRes.data as Acp | null) ?? null,
    occupants: (occRes.data as Occupant[] | null) ?? [],
    technicien: (techRes.data as Pick<Utilisateur, 'id' | 'prenom' | 'nom'> | null) ?? null,
    isCourtier: org.type === 'courtier',
    hasReport: intervention.statut === 'rapport' || intervention.statut === 'cloturee',
  };

  return <DossierPortalClient data={data} />;
}
