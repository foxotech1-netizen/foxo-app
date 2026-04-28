-- Module facturation FoxO — tables factures, articles, parametres.
--
-- Préreq : la fonction SECURITY DEFINER public.is_admin() existe déjà.
-- À exécuter dans le SQL editor de Supabase.

-- ─── Table principale : factures ─────────────────────────────────────────
create table if not exists public.factures (
  id uuid primary key default gen_random_uuid(),
  numero text unique not null,
  intervention_id uuid references public.interventions(id),
  organisation_id uuid references public.organisations(id),
  client_nom text,
  client_email text,
  client_adresse text,
  client_bce text,
  client_syndic text,
  lignes jsonb not null default '[]',
  details_intervention jsonb default '{}',
  remise_pct numeric default 0,
  tva_pct numeric default 21,
  montant_ht numeric,
  montant_tva numeric,
  montant_ttc numeric,
  notes text,
  remarques text,
  conditions_paiement text default '15 jours',
  reference text,
  reference_structuree text,
  statut text default 'brouillon' check (statut in ('brouillon','envoyee','payee','en_retard','annulee')),
  date_emission date,
  date_echeance date,
  date_paiement date,
  sent_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_factures_statut on public.factures (statut);
create index if not exists idx_factures_date_emission on public.factures (date_emission desc);
create index if not exists idx_factures_intervention on public.factures (intervention_id);
create index if not exists idx_factures_organisation on public.factures (organisation_id);
create index if not exists idx_factures_ref_structuree on public.factures (reference_structuree);

alter table public.factures enable row level security;

drop policy if exists "admin_all_factures" on public.factures;
create policy "admin_all_factures"
  on public.factures
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ─── Catalogue d'articles (prestations FoxO) ─────────────────────────────
create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  description text not null,
  prix_htva numeric not null,
  tva_pct numeric default 21,
  actif boolean default true,
  created_at timestamptz default now()
);

alter table public.articles enable row level security;

drop policy if exists "admin_all_articles" on public.articles;
create policy "admin_all_articles"
  on public.articles
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ─── Paramètres généraux (KV store) ──────────────────────────────────────
create table if not exists public.parametres (
  id uuid primary key default gen_random_uuid(),
  cle text unique not null,
  valeur text,
  updated_at timestamptz default now()
);

alter table public.parametres enable row level security;

drop policy if exists "admin_all_parametres" on public.parametres;
create policy "admin_all_parametres"
  on public.parametres
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ─── Seeds ───────────────────────────────────────────────────────────────
insert into public.parametres (cle, valeur) values
  ('email_comptable',     ''),
  ('payment_terms_days',  '15'),
  ('ponto_enabled',       'false'),
  ('ponto_api_key',       '')
on conflict (cle) do nothing;

insert into public.articles (code, description, prix_htva) values
  ('DEP001', 'Déplacement', 61.98),
  ('FOR001', 'Forfait détection de fuite AVEC remise d''un rapport écrit', 351.24),
  ('FOR002', 'Forfait détection de fuite AVEC remise d''un rapport écrit', 396.70),
  ('FOR003', 'Forfait détection de fuite SANS remise d''un rapport écrit', 285.12),
  ('FOR004', 'Forfait inspection caméra AVEC remise d''un rapport écrit', 285.12),
  ('FOR005', 'Forfait inspection caméra SANS remise d''un rapport écrit', 202.48),
  ('HEU001', 'Heures supp', 61.98),
  ('RAP001', 'Rédaction Rapport', 66.12)
on conflict (code) do nothing;
