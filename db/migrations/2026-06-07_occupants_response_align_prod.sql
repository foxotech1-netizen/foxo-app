-- 2026-06-07_occupants_response_align_prod.sql
--
-- ENREGISTREMENT D'ALIGNEMENT PROD (pas une nouvelle fonctionnalite).
--
-- Contexte : la migration db/migrations/2026-05-23_occupants_response.sql
-- n'avait JAMAIS ete appliquee a la base de production. Le depot etait
-- coherent (colonne confirmed_at), mais la prod avait derive : une colonne
-- egaree confirme_at (FR, sans "d"), et AUCUNE de confirmed_at /
-- proposed_creneau_debut / proposed_creneau_fin / response_note, ni la
-- table occupant_responses_log. Symptome : le clic occupant "je serai
-- present" echouait (PostgREST : colonne introuvable dans le cache).
--
-- Correctif applique en prod le 2026-06-07 via Supabase SQL Editor :
--   1) rename confirme_at -> confirmed_at (donnees preservees) ;
--   2) re-application idempotente complete de la migration 2026-05-23.
--
-- Ce fichier ACTE cet alignement. Il est idempotent et NO-OP sur une base
-- deja a jour (prod). Inutile de le rejouer dans Supabase.

-- 1) Renommage de la colonne egaree (uniquement si l'ancien nom existe
--    et que le nouveau n'existe pas encore).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'occupants'
      and column_name = 'confirme_at'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'occupants'
      and column_name = 'confirmed_at'
  ) then
    alter table public.occupants rename column confirme_at to confirmed_at;
  end if;
end $$;

-- 2) Re-application idempotente de 2026-05-23_occupants_response.sql.
alter table public.occupants
  add column if not exists confirmed_at timestamptz,
  add column if not exists proposed_creneau_debut timestamptz,
  add column if not exists proposed_creneau_fin timestamptz,
  add column if not exists response_note text;

create table if not exists public.occupant_responses_log (
  id uuid primary key default gen_random_uuid(),
  occupant_id uuid not null
    references public.occupants(id) on delete cascade,
  intervention_id uuid not null
    references public.interventions(id) on delete cascade,
  reponse text not null
    check (reponse in ('confirme','decline','counter')),
  proposed_creneau_debut timestamptz,
  proposed_creneau_fin timestamptz,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_occupant_responses_intervention
  on public.occupant_responses_log (intervention_id, created_at desc);
create index if not exists idx_occupant_responses_occupant
  on public.occupant_responses_log (occupant_id, created_at desc);

alter table public.occupant_responses_log enable row level security;

drop policy if exists "admin_all_responses_log" on public.occupant_responses_log;
create policy "admin_all_responses_log"
  on public.occupant_responses_log
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 3) Forcer PostgREST a recharger son cache de schema.
notify pgrst, 'reload schema';
