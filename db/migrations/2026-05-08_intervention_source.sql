-- Source d'une intervention : 'portail' (par défaut), 'mail', 'calendar',
-- 'admin', 'rdv'. La colonne existe déjà depuis 2026-05-07_mail_auto.sql,
-- on garantit ici qu'elle a bien le default 'portail' (idempotent).

alter table public.interventions
  add column if not exists source text default 'portail';

alter table public.interventions
  alter column source set default 'portail';

create index if not exists idx_interventions_source
  on public.interventions (source);
