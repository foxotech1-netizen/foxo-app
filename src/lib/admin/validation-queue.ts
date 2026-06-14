// Source unique des prédicats de la file de validation (/admin/validation).
//
// Les fonctions apply* posent les filtres d'UNE source sur un query builder
// Supabase. Elles sont réutilisables pour LISTER (.select(colonnes)) OU
// COMPTER (.select('*', { count: 'exact', head: true })) : le générique Q
// préserve le type concret du builder en entrée/sortie.
// getSuspensCount / getValidationTotal s'appuient dessus pour rester alignés
// avec les listes affichées par la page.

import type { createClient } from '@/lib/supabase/server';

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

// Sous-ensemble des méthodes de filtre Supabase utilisées par la file.
// Le générique Q (non contraint) conserve le type concret du builder à
// travers apply* — ce qui permet d'enchaîner ensuite .order()/.select() côté
// appelant. Le filtre est posé via ce contrat minimal pour éviter le TS2589
// (instanciation de type trop profonde) qu'entraînerait une contrainte
// structurelle sur le type complet du PostgrestFilterBuilder.
interface FilterableQuery {
  eq(column: string, value: unknown): FilterableQuery;
  is(column: string, value: unknown): FilterableQuery;
  in(column: string, values: readonly unknown[]): FilterableQuery;
}

// 1. Analyses mails à confirmer : demande d'intervention sans dossier lié.
export function applyMailsAConfirmer<Q>(q: Q): Q {
  return (q as FilterableQuery).eq('type', 'demande_intervention').is('dossier_match_id', null) as Q;
}

// 2. Rapports à valider : rapports en brouillon ou validé (transmis exclu),
//    DONT l'intervention parente n'est PAS soft-deletée. Approche 2 requêtes
//    (pas de FK fiable rapports->interventions pour un embed PostgREST) —
//    réplique de la logique de listing de /admin/validation/page.tsx, pour
//    que le badge sidebar, la pastille hub et la page comptent pareil.
export async function getRapportsAValiderCount(supabase: SupabaseServer): Promise<number> {
  const { data: rows } = await supabase
    .from('rapports')
    .select('intervention_id')
    .in('statut', ['brouillon', 'valide']);
  const ids = (rows ?? [])
    .map((r: { intervention_id: string | null }) => r.intervention_id)
    .filter((id: string | null): id is string => Boolean(id));
  if (ids.length === 0) return 0;
  const uniqueIds = [...new Set(ids)];
  const { data: vivantes } = await supabase
    .from('interventions')
    .select('id')
    .in('id', uniqueIds)
    .is('deleted_at', null);
  const vivantesSet = new Set((vivantes ?? []).map((i: { id: string }) => i.id));
  return ids.filter((id: string) => vivantesSet.has(id)).length;
}

// 3. Factures / devis en brouillon.
export function applyFacturesBrouillon<Q>(q: Q): Q {
  return (q as FilterableQuery).eq('statut', 'brouillon').is('deleted_at', null) as Q;
}

// 4. Notes de frais à approuver : statut 'soumise'.
export function applyNotesFraisSoumises<Q>(q: Q): Q {
  return (q as FilterableQuery).eq('statut', 'soumise') as Q;
}

// 5. Interventions en suspens : DEUX ensembles DISJOINTS sommés (pas de .or()).
//    - statut 'en_suspens'
//    - statut 'nouvelle' SANS technicien
//    Les deux sont mutuellement exclusifs (statut différent) → la somme des
//    counts est exacte, sans double comptage.
export async function getSuspensCount(supabase: SupabaseServer): Promise<number> {
  const [enSuspens, nouvellesNonAssignees] = await Promise.all([
    supabase
      .from('interventions')
      .select('*', { count: 'exact', head: true })
      .eq('statut', 'en_suspens')
      .is('deleted_at', null),
    supabase
      .from('interventions')
      .select('*', { count: 'exact', head: true })
      .eq('statut', 'nouvelle')
      .is('technicien_id', null)
      .is('deleted_at', null),
  ]);
  return (enSuspens.count ?? 0) + (nouvellesNonAssignees.count ?? 0);
}

// Total de la file : counts des 4 sources (head:true) + interventions en suspens.
export async function getValidationTotal(supabase: SupabaseServer): Promise<number> {
  const [mails, rapportsCount, factures, notes, suspens] = await Promise.all([
    applyMailsAConfirmer(
      supabase.from('mails_analyses').select('*', { count: 'exact', head: true }),
    ),
    getRapportsAValiderCount(supabase),
    applyFacturesBrouillon(
      supabase.from('factures').select('*', { count: 'exact', head: true }),
    ),
    applyNotesFraisSoumises(
      supabase.from('notes_frais').select('*', { count: 'exact', head: true }),
    ),
    getSuspensCount(supabase),
  ]);
  return (
    (mails.count ?? 0) +
    rapportsCount +
    (factures.count ?? 0) +
    (notes.count ?? 0) +
    suspens
  );
}
