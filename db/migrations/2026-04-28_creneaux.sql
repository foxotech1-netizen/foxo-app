-- Refonte du système de disponibilités.
--
-- Principe : créneaux FERMÉS par défaut. Seules les lignes présentes dans
-- creneaux_disponibles avec statut='libre' sont visibles côté public
-- (portal syndic et /rdv particulier). L'admin crée explicitement les
-- plages depuis /admin/planning > onglet "Gérer les disponibilités".
--
-- Préreq : la fonction SECURITY DEFINER public.is_admin() existe déjà.
-- À exécuter dans le SQL editor de Supabase.

-- ─── Table principale : créneaux disponibles ─────────────────────────────
create table if not exists public.creneaux_disponibles (
  id uuid primary key default gen_random_uuid(),
  technicien_id uuid references public.utilisateurs(id) on delete cascade,
  date date not null,
  heure_debut text not null,
  heure_fin text not null,
  statut text default 'libre' check (statut in ('libre','reserve','bloque')),
  intervention_id uuid references public.interventions(id),
  google_event_id text,
  created_at timestamptz default now(),
  unique(technicien_id, date, heure_debut)
);

create index if not exists idx_creneaux_disponibles_date
  on public.creneaux_disponibles (date);
create index if not exists idx_creneaux_disponibles_tech_date
  on public.creneaux_disponibles (technicien_id, date);

alter table public.creneaux_disponibles enable row level security;

drop policy if exists "admin_all_creneaux" on public.creneaux_disponibles;
create policy "admin_all_creneaux"
  on public.creneaux_disponibles
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "public_read_creneaux" on public.creneaux_disponibles;
create policy "public_read_creneaux"
  on public.creneaux_disponibles
  for select
  to authenticated
  using (true);

-- Lecture anonyme aussi (formulaire /rdv particulier non connecté).
drop policy if exists "anon_read_creneaux_libres" on public.creneaux_disponibles;
create policy "anon_read_creneaux_libres"
  on public.creneaux_disponibles
  for select
  to anon
  using (statut = 'libre');

-- ─── Table secondaire : créneaux bloqués (congés / déplacements) ─────────
create table if not exists public.creneaux_bloques (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  heure text,
  technicien_id uuid references public.utilisateurs(id),
  motif text,
  google_event_id text,
  created_at timestamptz default now()
);

create index if not exists idx_creneaux_bloques_date
  on public.creneaux_bloques (date);

alter table public.creneaux_bloques enable row level security;

drop policy if exists "admin_all_creneaux_bloques" on public.creneaux_bloques;
create policy "admin_all_creneaux_bloques"
  on public.creneaux_bloques
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
