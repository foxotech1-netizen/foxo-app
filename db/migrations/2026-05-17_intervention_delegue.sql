-- Liens demandeur enrichis :
-- - interventions.delegue_id : la personne qui a envoyé le mail (le syndic
--   est l'organisation, le délégué est l'humain qui agit pour elle).
--   Le cron check-mails et apply-reanalysis créent automatiquement le
--   délégué s'il n'existe pas dans la table `delegues`.
-- - occupants.type_occupant : 'occupant' (résident), 'proprietaire'
--   (propriétaire bailleur, ne réside pas), ou 'parties_communes'
--   (zone commune sans résident — escaliers, couloir, hall…).
-- - occupants.appartement existe déjà (migration 2026-05-01) — la ligne
--   ci-dessous est idempotente.

alter table public.interventions
  add column if not exists delegue_id uuid
    references public.delegues(id);

alter table public.occupants
  add column if not exists appartement text;

alter table public.occupants
  add column if not exists type_occupant text
    default 'occupant'
    check (type_occupant in ('occupant', 'proprietaire', 'parties_communes'));

create index if not exists idx_interventions_delegue
  on public.interventions (delegue_id);
