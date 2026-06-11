// Filtre de visibilité des interventions côté portail partenaire — source
// unique (audit qualité 2026-06-11, B2). Une intervention est visible pour
// une organisation si :
//   - lien direct legacy   : interventions.syndic_id = org.id
//   - lien direct nouveau  : interventions.organisation_id = org.id
//   - mandat dossier       : id ∈ dossiers_sinistres.courtier_id = org.id
//     (courtier ET expert — audit cohérence #19)
//
// La clause id.in.(…) n'est ajoutée que si la liste de mandats est non vide
// (un id.in.() vide est invalide côté PostgREST).
//
// Usage : .or(buildOrgVisibilityFilter(org.id, mandatedIds)) — penser à
// combiner avec .is('deleted_at', null) (soft delete, aligné admin).

export { getMandatedInterventionIds } from '@/lib/portal/syndic';

export function buildOrgVisibilityFilter(
  orgId: string,
  mandatedInterventionIds: string[],
): string {
  const base = `syndic_id.eq.${orgId},organisation_id.eq.${orgId}`;
  return mandatedInterventionIds.length > 0
    ? `${base},id.in.(${mandatedInterventionIds.join(',')})`
    : base;
}
