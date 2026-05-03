-- Soft delete pour factures, devis et avoirs (table partagée public.factures).
-- Même pattern que 2026-05-22_intervention_soft_delete.sql : la colonne reste
-- null tant que le document est actif ; un timestamptz est posé quand
-- l'admin clique sur "Supprimer" depuis la liste (action visible uniquement
-- pour les brouillons).
--
-- Index partiel sur deleted_at pour accélérer le filtre `IS NULL` qui sera
-- ajouté à toutes les queries admin de listage (facturation, devis,
-- notes de crédit).

alter table public.factures
  add column if not exists deleted_at timestamptz;

create index if not exists idx_factures_active
  on public.factures (date_emission desc)
  where deleted_at is null;
