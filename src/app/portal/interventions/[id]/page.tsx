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
  // Vrai pour les orgs "dossier sinistre" (courtier ET expert) — pilote
  // l'affichage du bloc Assuré / assureur dans DossierPortalClient.
  isSinistre: boolean;
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

  // Sécurité : intervention rattachée au syndic (legacy syndic_id) OU à l'org
  // du délégué connecté (organisation_id) OU mandat via dossier sinistre
  // (courtier/expert mandaté — audit #19, le redirect ne doit plus éjecter un
  // courtier mandaté). On vérifie d'abord le mandat dossier ; si présent, on
  // lève le filtre org (l'accès est déjà prouvé), sinon on garde le filtre.
  const { data: dossier } = await supabase
    .from('dossiers_sinistres')
    .select('intervention_id')
    .eq('intervention_id', id)
    .eq('courtier_id', org.id)
    .maybeSingle();
  const viaDossier = !!dossier;

  let ivQuery = supabase
    .from('interventions')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null);
  if (!viaDossier) {
    ivQuery = ivQuery.or(`syndic_id.eq.${org.id},organisation_id.eq.${org.id}`);
  }
  const { data: iv } = await ivQuery.maybeSingle();

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

  // Rapport disponible = une ligne rapports visible via RLS (policy
  // partner_select_published_rapports = statut 'transmis'). Aligne
  // l'affichage sur ce que le syndic peut réellement télécharger.
  const { data: rapportRows } = await supabase
    .from('rapports')
    .select('intervention_id')
    .eq('intervention_id', intervention.id);
  const hasReport = (rapportRows?.length ?? 0) > 0;

  const data: DossierData = {
    intervention,
    acp: (acpRes.data as Acp | null) ?? null,
    occupants: (occRes.data as Occupant[] | null) ?? [],
    technicien: (techRes.data as Pick<Utilisateur, 'id' | 'prenom' | 'nom'> | null) ?? null,
    isSinistre: org.type === 'courtier' || org.type === 'expert',
    hasReport,
  };

  return <DossierPortalClient data={data} />;
}
