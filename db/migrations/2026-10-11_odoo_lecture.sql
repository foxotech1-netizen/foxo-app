-- Chantier « Odoo visible dans FoxO » — rangement séparé, en LECTURE SEULE.
--
-- Trois tables À PART des factures FoxO (factures / factures_achat) :
--   odoo_factures              : factures de vente et d'achat comptabilisées dans Odoo ;
--   odoo_mouvements_bancaires  : mouvements bancaires Odoo (= paiements reçus / envoyés) ;
--   odoo_synchronisations      : journal des passages (sert aussi de verrou).
-- Écriture : service-role uniquement (synchronisation serveur). Lecture : admins.
-- Idempotente : rejouable sans effet de bord. À appliquer en prod AVANT le code.

-- ─── 1. Factures Odoo ───────────────────────────────────────────────────────
create table if not exists public.odoo_factures (
  id uuid primary key default gen_random_uuid(),
  societe_id uuid references public.societes(id),
  odoo_id bigint not null,
  odoo_societe_id integer,
  sens text not null check (sens in ('vente', 'achat')),
  est_note_credit boolean not null default false,
  numero text,
  reference text,
  communication text,
  tiers_nom text,
  odoo_tiers_id bigint,
  date_facture date,
  date_echeance date,
  montant_ht numeric(14,2),
  montant_tva numeric(14,2),
  montant_ttc numeric(14,2),
  montant_restant numeric(14,2),
  devise text,
  -- Valeur Odoo brute (not_paid, in_payment, paid, partial, reversed…) : pas de
  -- CHECK, Odoo peut en ajouter.
  etat_paiement text not null,
  -- [{ date, montant, journal, odoo_move_id }] — odoo_move_id = écriture du
  -- mouvement bancaire (cf. odoo_mouvements_bancaires.odoo_move_id).
  reglements jsonb not null default '[]'::jsonb,
  date_dernier_reglement date,
  -- Numéro de dossier FoxO lu en tête de la référence Odoo (ventes).
  dossier_ref text,
  intervention_id uuid references public.interventions(id) on delete set null,
  odoo_modifie_le timestamptz,
  synchronise_le timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists odoo_factures_odoo_id_key on public.odoo_factures (odoo_id);
create index if not exists idx_odoo_factures_sens_date on public.odoo_factures (sens, date_facture desc);
create index if not exists idx_odoo_factures_intervention on public.odoo_factures (intervention_id);
create index if not exists idx_odoo_factures_synchronise on public.odoo_factures (synchronise_le);

alter table public.odoo_factures enable row level security;
alter table public.odoo_factures force row level security;
drop policy if exists "admin_read_odoo_factures" on public.odoo_factures;
create policy "admin_read_odoo_factures"
  on public.odoo_factures for select to authenticated
  using (public.is_admin());

-- ─── 2. Mouvements bancaires Odoo ───────────────────────────────────────────
create table if not exists public.odoo_mouvements_bancaires (
  id uuid primary key default gen_random_uuid(),
  societe_id uuid references public.societes(id),
  odoo_id bigint not null,
  odoo_move_id bigint,
  odoo_societe_id integer,
  date_mouvement date not null,
  -- Positif = entrée (paiement reçu), négatif = sortie (paiement envoyé).
  montant numeric(14,2) not null,
  tiers_nom text,
  communication text,
  journal text,
  rapproche boolean,
  odoo_modifie_le timestamptz,
  synchronise_le timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists odoo_mouvements_bancaires_odoo_id_key on public.odoo_mouvements_bancaires (odoo_id);
create index if not exists idx_odoo_mouvements_date on public.odoo_mouvements_bancaires (date_mouvement desc);
create index if not exists idx_odoo_mouvements_move on public.odoo_mouvements_bancaires (odoo_move_id);
create index if not exists idx_odoo_mouvements_synchronise on public.odoo_mouvements_bancaires (synchronise_le);

alter table public.odoo_mouvements_bancaires enable row level security;
alter table public.odoo_mouvements_bancaires force row level security;
drop policy if exists "admin_read_odoo_mouvements_bancaires" on public.odoo_mouvements_bancaires;
create policy "admin_read_odoo_mouvements_bancaires"
  on public.odoo_mouvements_bancaires for select to authenticated
  using (public.is_admin());

-- ─── 3. Journal des synchronisations ────────────────────────────────────────
create table if not exists public.odoo_synchronisations (
  id uuid primary key default gen_random_uuid(),
  societe_id uuid references public.societes(id),
  demarree_le timestamptz not null default now(),
  terminee_le timestamptz,
  declencheur text not null check (declencheur in ('manuel', 'planifie')),
  statut text not null default 'en_cours' check (statut in ('en_cours', 'ok', 'erreur')),
  nb_factures integer,
  nb_mouvements integer,
  nb_appels integer,
  duree_ms integer,
  erreur text,
  lance_par text
);
create index if not exists idx_odoo_synchronisations_demarree on public.odoo_synchronisations (demarree_le desc);

alter table public.odoo_synchronisations enable row level security;
alter table public.odoo_synchronisations force row level security;
drop policy if exists "admin_read_odoo_synchronisations" on public.odoo_synchronisations;
create policy "admin_read_odoo_synchronisations"
  on public.odoo_synchronisations for select to authenticated
  using (public.is_admin());

-- ─── 4. Réglages (table parametres) ─────────────────────────────────────────
-- Société Odoo lue (1 = Fox Group, constaté au diagnostic du 11/10/2026),
-- début de période, et interrupteur du passage NOCTURNE (éteint par défaut :
-- on l'allume après un premier passage manuel réussi).
insert into public.parametres (cle, valeur) values
  ('odoo_lecture_societe_id', '1'),
  ('odoo_lecture_depuis', '2026-01-01'),
  ('odoo_lecture_active', 'false')
on conflict (cle) do nothing;

notify pgrst, 'reload schema';

-- Contrôle : les 3 réglages doivent s'afficher.
select cle, valeur from public.parametres where cle like 'odoo_lecture_%' order by cle;
