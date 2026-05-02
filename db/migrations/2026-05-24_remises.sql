-- Système de remises FoxO sur 3 niveaux : ligne, globale, automatique client.
--
-- Note importante : les lignes de facture sont stockées en JSONB dans
-- factures.lignes (cf. 2026-04-29_facturation.sql), et NON dans une table
-- facture_lignes dédiée. Les champs remise_valeur / remise_type /
-- remise_description par ligne sont donc ajoutés au shape JSON par la
-- couche applicative — aucun ALTER côté DB pour les lignes.
--
-- Cette migration couvre :
--   1. Remise globale au niveau facture (3 colonnes sur factures)
--   2. Remise automatique par client (3 colonnes sur clients)
--   3. Migration douce de l'ancien factures.remise_pct (% uniquement)
--      vers les nouveaux champs typés.
--
-- Règles encodées en CHECK :
--   - description obligatoire (non vide) si remise > 0
--   - si type='pct', valeur bornée à [0, 100]
-- La règle "remise fixe ne peut pas dépasser le montant concerné" reste
-- applicative (la DB ne connaît pas le sous-total HTVA d'une facture
-- dont les lignes sont en JSONB).

-- ─── Niveau facture : remise globale ─────────────────────────────────
alter table public.factures
  add column if not exists remise_globale_valeur numeric default 0,
  add column if not exists remise_globale_type text
    check (remise_globale_type in ('pct','fixe')),
  add column if not exists remise_globale_description text;

alter table public.factures
  drop constraint if exists factures_remise_globale_description_check;
alter table public.factures
  add constraint factures_remise_globale_description_check
  check (
    coalesce(remise_globale_valeur, 0) = 0
    or (remise_globale_description is not null
        and length(trim(remise_globale_description)) > 0)
  );

alter table public.factures
  drop constraint if exists factures_remise_globale_pct_check;
alter table public.factures
  add constraint factures_remise_globale_pct_check
  check (
    remise_globale_type is null
    or remise_globale_type = 'fixe'
    or (remise_globale_type = 'pct'
        and coalesce(remise_globale_valeur, 0) between 0 and 100)
  );

-- Migration douce de l'ancien remise_pct → nouveaux champs typés.
-- Idempotent grâce aux filtres `coalesce(...) = 0` / `is null`.
-- L'ancienne colonne remise_pct est conservée en lecture pour
-- rétro-compat ; la couche applicative ne l'écrira plus.
update public.factures
set remise_globale_valeur = remise_pct,
    remise_globale_type   = 'pct',
    remise_globale_description = 'Remise (migrée depuis remise_pct)'
where coalesce(remise_pct, 0) > 0
  and coalesce(remise_globale_valeur, 0) = 0
  and remise_globale_type is null;

-- ─── Niveau client : remise automatique ──────────────────────────────
alter table public.clients
  add column if not exists remise_auto_valeur numeric default 0,
  add column if not exists remise_auto_type text
    check (remise_auto_type in ('pct','fixe')),
  add column if not exists remise_auto_description text;

alter table public.clients
  drop constraint if exists clients_remise_auto_description_check;
alter table public.clients
  add constraint clients_remise_auto_description_check
  check (
    coalesce(remise_auto_valeur, 0) = 0
    or (remise_auto_description is not null
        and length(trim(remise_auto_description)) > 0)
  );

alter table public.clients
  drop constraint if exists clients_remise_auto_pct_check;
alter table public.clients
  add constraint clients_remise_auto_pct_check
  check (
    remise_auto_type is null
    or remise_auto_type = 'fixe'
    or (remise_auto_type = 'pct'
        and coalesce(remise_auto_valeur, 0) between 0 and 100)
  );
