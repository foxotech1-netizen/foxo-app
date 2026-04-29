-- Mail auto-analyse — compléments à 2026-05-07_mail_cron.sql.
--
-- - interventions.source : valeur par défaut 'portail' (avant : null)
-- - interventions.source_mail_id : Gmail message id (dédup côté DB)
-- - parametres.mail_last_check : timestamp ISO de la dernière passe du cron

alter table public.interventions
  alter column source set default 'portail';

update public.interventions
  set source = 'portail'
  where source is null;

alter table public.interventions
  add column if not exists source_mail_id text;

create index if not exists idx_interventions_source_mail_id
  on public.interventions (source_mail_id);

insert into public.parametres (cle, valeur)
values ('mail_last_check', '')
on conflict (cle) do nothing;
