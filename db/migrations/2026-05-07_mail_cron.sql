-- Cron analyse automatique des mails entrants.
--
-- - interventions.source : 'rdv' | 'portal' | 'admin' | 'mail' | null
--   (source du dossier — utilisé pour filtrage UI / tracking)
-- - intervention_timeline : table générique pour timeline d'événements
--   par dossier (création, changement statut, mail analysé, etc.)
-- - parametres.mail_auto_analyse : toggle d'activation du cron

alter table public.interventions
  add column if not exists source text;

create index if not exists idx_interventions_source
  on public.interventions (source);

create table if not exists public.intervention_timeline (
  id uuid primary key default gen_random_uuid(),
  intervention_id uuid references public.interventions(id) on delete cascade,
  type text not null,                -- ex: 'creation_mail', 'statut_change', 'rapport_publie'
  message text,                       -- texte affiché dans la timeline
  payload jsonb,                      -- données structurées (ex: mail_id, ancien_statut)
  created_at timestamptz default now(),
  created_by text                     -- email user ou 'cron:check-mails'
);

create index if not exists idx_timeline_intervention_date
  on public.intervention_timeline (intervention_id, created_at desc);

alter table public.intervention_timeline enable row level security;

drop policy if exists "admin_all_timeline" on public.intervention_timeline;
create policy "admin_all_timeline"
  on public.intervention_timeline
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Toggle d'activation du cron. Off par défaut — l'admin l'active
-- depuis /admin/parametres une fois Google connecté.
insert into public.parametres (cle, valeur)
values ('mail_auto_analyse', 'false')
on conflict (cle) do nothing;
