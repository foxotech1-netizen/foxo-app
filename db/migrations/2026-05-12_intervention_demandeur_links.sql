-- Liens externes pour interventions :
-- - reference_externe : référence dossier syndic/courtier (ex: DOS-2026-123)
-- - organisation_id   : lien vers le syndic/courtier matché (table organisations)
-- - client_id         : lien vers le particulier matché (table clients)
--
-- Ces colonnes sont remplies automatiquement par le cron check-mails
-- quand Claude identifie un type de demandeur. Existing rows = null.

alter table public.interventions
  add column if not exists reference_externe text;

alter table public.interventions
  add column if not exists organisation_id uuid references public.organisations(id);

alter table public.interventions
  add column if not exists client_id uuid references public.clients(id);

create index if not exists idx_interventions_organisation
  on public.interventions (organisation_id);

create index if not exists idx_interventions_client
  on public.interventions (client_id);
