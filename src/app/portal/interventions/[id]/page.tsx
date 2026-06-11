import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentSyndic } from '@/lib/portal/syndic';
import { buildOrgVisibilityFilter, getMandatedInterventionIds } from '@/lib/portal/org-visibility';
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

  // Sécurité : filtre canonique partagé (lien direct syndic_id/organisation_id
  // OU mandat dossier sinistre — cf. @/lib/portal/org-visibility). Le redirect
  // ne doit pas éjecter un courtier/expert mandaté (audit #19).
  const mandatedIds = await getMandatedInterventionIds(supabase, org.id);
  const { data: iv } = await supabase
    .from('interventions')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .or(buildOrgVisibilityFilter(org.id, mandatedIds))
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
