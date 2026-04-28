-- Base de données clients pour la facturation.
--
-- Contrairement à `organisations` (syndics/courtiers connectés au portail),
-- `clients` regroupe TOUS les destinataires possibles de facture :
-- ACP (immeubles), particuliers, autres entreprises. Une organisation peut
-- avoir un client miroir (même nom/email).
--
-- Préreq : public.is_admin() existe déjà.

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  type text default 'acp' check (type in ('acp','particulier','entreprise')),
  nom text not null,
  prenom text,
  email text,
  telephone text,
  adresse text,
  code_postal text,
  ville text,
  pays text default 'Belgique',
  bce text,
  tva text,
  contact_nom text,
  contact_email text,
  contact_telephone text,
  notes text,
  actif boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_clients_nom on public.clients (nom);
create index if not exists idx_clients_type on public.clients (type);
create index if not exists idx_clients_email on public.clients (email);

alter table public.clients enable row level security;

drop policy if exists "admin_all_clients" on public.clients;
create policy "admin_all_clients"
  on public.clients
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Lien optionnel facture → client (en plus du lien organisation existant).
-- Si la colonne existe déjà (migration ré-exécutée), no-op.
alter table public.factures
  add column if not exists client_id uuid references public.clients(id);
create index if not exists idx_factures_client on public.factures (client_id);

-- Import des organisations existantes comme clients (idempotent).
-- Les ACP / syndics deviennent type='acp', les courtiers type='entreprise'.
insert into public.clients (nom, type, email, telephone, bce, contact_nom)
select o.nom,
       case when o.type = 'syndic' then 'acp'
            when o.type = 'courtier' then 'entreprise'
            else 'entreprise'
       end,
       o.email,
       o.telephone,
       o.bce,
       o.contact
from public.organisations o
where not exists (
  select 1 from public.clients c
  where c.nom = o.nom and coalesce(c.email,'') = coalesce(o.email,'')
);
