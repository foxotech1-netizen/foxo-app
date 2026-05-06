-- Messagerie bidirectionnelle admin ↔ partenaire (syndic / courtier)
-- sur les interventions. Un message est rattaché à une intervention
-- et porte un auteur_type ('admin', 'syndic', 'courtier') + auteur_email
-- pour traçabilité.
-- Les flags lu_admin / lu_syndic alimentent les badges "messages non
-- lus" de chaque côté (sidebar admin et drawer portal).
--
-- Préreq : la fonction SECURITY DEFINER public.is_admin() existe déjà.

-- ─── 1. Table ─────────────────────────────────────────────────────────
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  intervention_id uuid not null
    references public.interventions(id) on delete cascade,
  auteur_type text not null check (auteur_type in ('admin', 'syndic', 'courtier')),
  auteur_email text not null,
  contenu text not null check (char_length(contenu) > 0),
  created_at timestamptz not null default now(),
  lu_admin boolean not null default false,
  lu_syndic boolean not null default false
);

-- ─── 2. Index ─────────────────────────────────────────────────────────
-- Listing par intervention (cas le plus fréquent : ouverture d'un dossier).
create index if not exists idx_messages_intervention
  on public.messages (intervention_id, created_at desc);

-- Compteurs "non lus" par côté. Index partiels pour rester compacts —
-- un message lu disparaît de l'index, et on ne tracke "non lu" que
-- depuis l'autre partie (un syndic ne peut pas avoir un message à lui
-- comme "non lu côté syndic").
create index if not exists idx_messages_unread_admin
  on public.messages (intervention_id)
  where lu_admin = false and auteur_type in ('syndic', 'courtier');

create index if not exists idx_messages_unread_syndic
  on public.messages (intervention_id)
  where lu_syndic = false and auteur_type = 'admin';

-- ─── 3. Helper SECURITY DEFINER : ce syndic accède-t-il à l'intervention ? ──
-- Vérifie que auth.email() est délégué actif d'une organisation liée à
-- l'intervention (legacy syndic_id OU nouveau lien organisation_id).
--
-- SECURITY DEFINER pour bypass les RLS sur delegues / interventions —
-- sinon la policy serait circulaire (les RLS interventions dépendent
-- déjà de delegues via "delegue_own_org" dans 2026-05-13_delegues.sql).
-- search_path verrouillé à public pour éviter les hijacks sur des
-- schémas tiers.
create or replace function public.syndic_owns_intervention(p_intervention_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.interventions iv
    join public.delegues d
      on (d.organisation_id = iv.syndic_id
          or d.organisation_id = iv.organisation_id)
    where iv.id = p_intervention_id
      and lower(d.email) = lower(auth.email())
      and d.actif = true
  );
$$;

-- Restriction d'exécution : seuls les rôles authenticated peuvent
-- appeler cette fonction. Le rôle anon (portail occupant public, page
-- /rdv) n'a pas à la voir.
revoke execute on function public.syndic_owns_intervention(uuid) from public;
grant  execute on function public.syndic_owns_intervention(uuid) to authenticated;

-- ─── 4. RLS ────────────────────────────────────────────────────────────
alter table public.messages enable row level security;

-- Admin : accès complet (lecture, insertion, update flags lu_*, suppression).
drop policy if exists "admin_all_messages" on public.messages;
create policy "admin_all_messages"
  on public.messages for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Syndic : SELECT sur les messages d'une intervention de son organisation.
drop policy if exists "syndic_select_messages" on public.messages;
create policy "syndic_select_messages"
  on public.messages for select to authenticated
  using (public.syndic_owns_intervention(intervention_id));

-- Syndic : INSERT uniquement de SES propres messages.
--   - intervention liée à son organisation
--   - auteur_type ∈ ('syndic','courtier') (impossible de poster en se faisant
--     passer pour admin)
--   - auteur_email = son email auth (impossible de poster au nom d'un collègue
--     ou d'un autre syndic — la traçabilité reste fiable)
drop policy if exists "syndic_insert_messages" on public.messages;
create policy "syndic_insert_messages"
  on public.messages for insert to authenticated
  with check (
    public.syndic_owns_intervention(intervention_id)
    and auteur_type in ('syndic', 'courtier')
    and lower(auteur_email) = lower(auth.email())
  );

-- Syndic : UPDATE limité — usage prévu = marquer lu_syndic = true à
-- l'ouverture du fil de messages (acknowledge). Côté applicatif, la
-- server action ne doit toucher QUE la colonne lu_syndic. La policy
-- elle-même autorise tous les UPDATE sur les rows de son périmètre ;
-- la restriction au seul flag est portée par le code.
drop policy if exists "syndic_update_lu_messages" on public.messages;
create policy "syndic_update_lu_messages"
  on public.messages for update to authenticated
  using (public.syndic_owns_intervention(intervention_id))
  with check (public.syndic_owns_intervention(intervention_id));
