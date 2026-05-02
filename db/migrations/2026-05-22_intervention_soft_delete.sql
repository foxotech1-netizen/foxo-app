-- Soft delete pour les interventions. La colonne reste null tant que
-- l'intervention est active ; un timestamptz est posé quand l'admin
-- clique sur l'icône poubelle dans la liste.
--
-- L'ancien endpoint DELETE /api/admin/interventions/[id] (hard delete
-- cascade) reste disponible pour d'éventuels usages internes — la
-- nouvelle route /delete (soft) est ce qu'utilise l'UI.
--
-- Index partiel sur deleted_at pour accélérer le filtre `IS NULL` qui
-- sera dans toutes les queries admin de listage.

alter table public.interventions
  add column if not exists deleted_at timestamptz;

create index if not exists idx_interventions_active
  on public.interventions (created_at desc)
  where deleted_at is null;
