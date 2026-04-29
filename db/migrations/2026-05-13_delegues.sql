-- Délégués par organisation : permet à plusieurs personnes d'un même
-- syndic / courtier d'accéder au portail FoxO et de voir uniquement
-- les dossiers de leur organisation.
--
-- Un email peut être délégué de plusieurs organisations (cas rare mais
-- supporté : la jointure sur `delegues.email = auth.email()` matche
-- toutes ses orgs).

create table if not exists public.delegues (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null
    references public.organisations(id) on delete cascade,
  email text not null,
  prenom text,
  nom text,
  telephone text,
  role text default 'delegue' check (role in ('admin', 'delegue')),
  actif boolean default true,
  invite_sent_at timestamptz,
  created_at timestamptz default now()
);

create unique index if not exists idx_delegues_org_email
  on public.delegues (organisation_id, lower(email));

create index if not exists idx_delegues_email_actif
  on public.delegues (lower(email))
  where actif = true;

alter table public.delegues enable row level security;

drop policy if exists "admin_all_delegues" on public.delegues;
create policy "admin_all_delegues"
  on public.delegues for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Un délégué peut lire ses propres lignes (utile pour le portail)
drop policy if exists "delegue_own_row" on public.delegues;
create policy "delegue_own_row"
  on public.delegues for select to authenticated
  using (lower(email) = lower(auth.email()));

-- ── RLS interventions : élargir pour les délégués ────────────────────
-- Un délégué actif voit toutes les interventions de son organisation.
-- Admin garde l'accès complet (policy existante is_admin).

drop policy if exists "delegue_own_org" on public.interventions;
create policy "delegue_own_org"
  on public.interventions for select to authenticated
  using (
    organisation_id in (
      select organisation_id from public.delegues
      where lower(email) = lower(auth.email()) and actif = true
    )
    or public.is_admin()
  );
