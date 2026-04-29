-- Stockage des tokens OAuth2 Google (compte unique partagé par l'admin
-- FoxO pour l'instant : Drive + Gmail + Calendar). Une seule ligne active
-- en pratique, mais on garde la structure compatible multi-comptes futurs.

create table if not exists public.google_tokens (
  id uuid primary key default gen_random_uuid(),
  access_token text,
  refresh_token text,
  expiry timestamptz,
  scope text,
  email text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_google_tokens_updated on public.google_tokens (updated_at desc);

alter table public.google_tokens enable row level security;

drop policy if exists "admin_all_google_tokens" on public.google_tokens;
create policy "admin_all_google_tokens"
  on public.google_tokens
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
