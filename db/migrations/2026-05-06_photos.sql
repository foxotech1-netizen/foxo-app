-- Photos terrain uploadées par les techniciens vers Drive.
-- Une ligne par photo : pointe vers le fichier Drive (drive_file_id) et
-- préserve l'historique même si le fichier est déplacé manuellement.

create table if not exists public.photos_interventions (
  id uuid primary key default gen_random_uuid(),
  intervention_id uuid references public.interventions(id) on delete cascade,
  drive_file_id text not null,
  drive_url text not null,
  filename text,
  uploaded_at timestamptz default now(),
  uploaded_by uuid references auth.users(id)
);

create index if not exists idx_photos_intervention on public.photos_interventions (intervention_id);
create index if not exists idx_photos_uploaded_at on public.photos_interventions (uploaded_at desc);

alter table public.photos_interventions enable row level security;

-- Tech : peut INSERT pour les interventions où il est assigné.
-- On utilise le helper SECURITY DEFINER existant tech_owns_intervention()
-- s'il existe, sinon on vérifie via la table utilisateurs.
drop policy if exists "tech_insert_photos" on public.photos_interventions;
create policy "tech_insert_photos"
  on public.photos_interventions
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.interventions i
      join public.utilisateurs u on u.id = i.technicien_id
      where i.id = intervention_id
        and u.email = (auth.jwt() ->> 'email')
    )
  );

-- Tech : SELECT sur ses propres interventions
drop policy if exists "tech_read_photos" on public.photos_interventions;
create policy "tech_read_photos"
  on public.photos_interventions
  for select
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.interventions i
      join public.utilisateurs u on u.id = i.technicien_id
      where i.id = intervention_id
        and u.email = (auth.jwt() ->> 'email')
    )
  );

-- Admin : ALL
drop policy if exists "admin_all_photos" on public.photos_interventions;
create policy "admin_all_photos"
  on public.photos_interventions
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
