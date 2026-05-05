-- 2026-05-30_user_preferences.sql
--
-- Préférences UI par utilisateur — pour l'instant juste le thème
-- (dark-amber / warm-light / foxo-blue). Future-proof : on peut
-- ajouter d'autres colonnes (langue, dense layout, etc.).
--
-- Hydratation côté client (cf. src/components/ThemeApplier.tsx) :
--   Supabase user_preferences → localStorage → défaut portail.
--
-- Préreq : table auth.users (Supabase Auth).

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme text check (theme in ('dark-amber', 'warm-light', 'foxo-blue')),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_preferences_updated_at
  on public.user_preferences (updated_at desc);

-- ─── RLS ──────────────────────────────────────────────────────────────
-- Chaque user voit/édite uniquement sa propre row. Les admins n'ont pas
-- besoin de lire les préférences des autres (= aucune policy admin).
alter table public.user_preferences enable row level security;

drop policy if exists "self_select_user_preferences" on public.user_preferences;
create policy "self_select_user_preferences"
  on public.user_preferences for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "self_insert_user_preferences" on public.user_preferences;
create policy "self_insert_user_preferences"
  on public.user_preferences for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "self_update_user_preferences" on public.user_preferences;
create policy "self_update_user_preferences"
  on public.user_preferences for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ─── Trigger updated_at ──────────────────────────────────────────────
create or replace function public.user_preferences_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_user_preferences_updated_at on public.user_preferences;
create trigger trg_user_preferences_updated_at
  before update on public.user_preferences
  for each row execute function public.user_preferences_set_updated_at();

NOTIFY pgrst, 'reload schema';
