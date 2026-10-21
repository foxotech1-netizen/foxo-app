-- Chantier « Créer la facture de vente en BROUILLON dans Odoo depuis FoxO ».
--
-- Décision Foxo (20-21/10/2026) : FoxO crée un brouillon dans Odoo, jamais
-- validé par FoxO ; Foxo contrôle, valide et envoie depuis Odoo (numéro légal,
-- TVA, Peppol restent à Odoo). La synchronisation de lecture ramène ensuite
-- la facture validée dans odoo_factures.
--
-- Deux tables À PART, en plus du miroir (2026-10-11_odoo_lecture.sql) :
--   odoo_brouillons : un enregistrement par brouillon créé dans Odoo depuis un dossier ;
--   odoo_appels     : journal de CHAQUE appel du flux d'écriture (lectures
--                     préparatoires comprises), réussi ou non.
-- Plus un interrupteur métier : parametres.odoo_ecriture_active (éteint par
-- défaut — on l'allume pour le brouillon d'essai, après déploiement du code).
-- Écriture : service-role uniquement. Lecture : admins.
-- Idempotente : rejouable sans effet de bord. À appliquer en prod AVANT le code.

-- ─── 1. Brouillons créés dans Odoo ──────────────────────────────────────────
create table if not exists public.odoo_brouillons (
  id uuid primary key default gen_random_uuid(),
  societe_id uuid references public.societes(id),
  intervention_id uuid references public.interventions(id) on delete set null,
  -- Copie du numéro de dossier au moment de la création (« 2026-238 »).
  dossier_ref text not null,
  -- Identifiant de l'account.move brouillon dans Odoo.
  odoo_move_id bigint not null,
  odoo_partner_id bigint not null,
  odoo_partner_nom text,
  -- La fiche client a été créée par FoxO lors de ce brouillon.
  partner_cree boolean not null default false,
  -- Champ « Référence » d'Odoo : « 2026-238 Rue Willems 14 » — c'est lui qui
  -- relie la facture au dossier une fois validée (cf. odoo-sync.ts).
  reference text not null,
  date_facture date,
  montant_ht numeric(14,2),
  montant_tva numeric(14,2),
  montant_ttc numeric(14,2),
  -- Ce qui a été envoyé à Odoo (client, lignes, note…), sans aucun secret.
  charge jsonb not null default '{}'::jsonb,
  -- brouillon = créé, en attente dans Odoo ; valide = retrouvé validé par la
  -- synchronisation ; supprime = introuvable dans Odoo lors d'une vérification.
  etat text not null default 'brouillon' check (etat in ('brouillon', 'valide', 'supprime')),
  -- Numéro définitif (FV2026-xxx), lu après validation.
  odoo_numero text,
  cree_le timestamptz not null default now(),
  cree_par text,
  verifie_le timestamptz
);
create unique index if not exists odoo_brouillons_move_key on public.odoo_brouillons (odoo_move_id);
create index if not exists idx_odoo_brouillons_intervention on public.odoo_brouillons (intervention_id);
create index if not exists idx_odoo_brouillons_cree on public.odoo_brouillons (cree_le desc);

alter table public.odoo_brouillons enable row level security;
alter table public.odoo_brouillons force row level security;
drop policy if exists "admin_read_odoo_brouillons" on public.odoo_brouillons;
create policy "admin_read_odoo_brouillons"
  on public.odoo_brouillons for select to authenticated
  using (public.is_admin());

-- ─── 2. Journal des appels d'écriture ───────────────────────────────────────
create table if not exists public.odoo_appels (
  id uuid primary key default gen_random_uuid(),
  societe_id uuid references public.societes(id),
  intervention_id uuid references public.interventions(id) on delete set null,
  brouillon_id uuid references public.odoo_brouillons(id) on delete set null,
  -- Modèle et méthode Odoo appelés (res.partner / create, account.move / create…).
  modele text not null,
  methode text not null,
  sens text not null check (sens in ('lecture', 'ecriture')),
  -- Arguments réduits à l'essentiel (jamais de clé, jamais d'adresse e-mail
  -- d'occupant) : de quoi comprendre ce qui a été demandé.
  resume jsonb not null default '{}'::jsonb,
  ok boolean not null,
  -- Résultat court (identifiant créé, nombre de lignes lues…).
  resultat text,
  erreur text,
  duree_ms integer,
  appele_le timestamptz not null default now(),
  appele_par text
);
create index if not exists idx_odoo_appels_appele on public.odoo_appels (appele_le desc);
create index if not exists idx_odoo_appels_brouillon on public.odoo_appels (brouillon_id);
create index if not exists idx_odoo_appels_intervention on public.odoo_appels (intervention_id);

alter table public.odoo_appels enable row level security;
alter table public.odoo_appels force row level security;
drop policy if exists "admin_read_odoo_appels" on public.odoo_appels;
create policy "admin_read_odoo_appels"
  on public.odoo_appels for select to authenticated
  using (public.is_admin());

-- ─── 3. Interrupteur (table parametres) ─────────────────────────────────────
-- Éteint par défaut : tant qu'il vaut 'false', FoxO n'écrit RIEN dans Odoo.
-- Distinct de odoo_sync_enabled (ancien connecteur de juillet, hors service)
-- et de odoo_lecture_active (passage nocturne de lecture).
insert into public.parametres (cle, valeur) values
  ('odoo_ecriture_active', 'false')
on conflict (cle) do nothing;

notify pgrst, 'reload schema';

-- Contrôle : 2 tables (odoo_appels, odoo_brouillons) et le réglage à 'false'.
select table_name
  from information_schema.tables
 where table_schema = 'public' and table_name in ('odoo_brouillons', 'odoo_appels')
 order by table_name;
select cle, valeur from public.parametres where cle = 'odoo_ecriture_active';
