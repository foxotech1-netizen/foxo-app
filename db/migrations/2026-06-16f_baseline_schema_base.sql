-- ============================================================
-- 2026-06-16f — BASELINE du schema de base non versionne (audit 2026-06-16)
-- ============================================================
-- Capture documentaire de la fondation creee au demarrage HORS db/migrations/
-- (relevee en prod le 2026-06-16). But : disposer d'une reference versionnee
-- pour pouvoir auditer la base a l'avenir.
--
-- Idempotente (DO ... IF NOT EXISTS / CREATE TABLE IF NOT EXISTS). Ce fichier
-- n'est re-execute par aucun runtime (archive). PK / FK / RLS / index ne sont
-- PAS redeclares ici (ils existent en prod ; contraintes CHECK et policies
-- couvertes par l'audit et les archives 2026-06-16b/c/d). On capture les enums
-- de base + la structure colonne (type / nullabilite / defaut) telle qu'en prod.
-- ============================================================

-- ---------- Enums de base (non versionnes avant ce jour) ----------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='intervention_type') THEN
    CREATE TYPE public.intervention_type AS ENUM ('Fuite canalisation','Fuite chauffage','Fuite infiltration','Surconsommation eau','Autre');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='intervention_statut') THEN
    CREATE TYPE public.intervention_statut AS ENUM ('nouvelle','attente','confirmee','realisee','rapport','cloturee','en_suspens');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='intervention_priorite') THEN
    CREATE TYPE public.intervention_priorite AS ENUM ('normale','urgente');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='occupant_statut') THEN
    CREATE TYPE public.occupant_statut AS ENUM ('attente','confirme','refuse');
  END IF;
  -- Rappel : user_role est deja versionne (2026-05-11b), 12 valeurs.
END $$;

-- ---------- Tables de base (structure colonne, telle qu'en prod) ----------

CREATE TABLE IF NOT EXISTS public.acps (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  syndic_id uuid NOT NULL,
  nom text NOT NULL,
  adresse text NOT NULL,
  code_postal text, ville text, bce text,
  nb_appartements integer,
  email_rapport text, email_facturation text, nom_facturation text,
  bce_facturation text, ref_bon_commande text,
  created_at timestamptz DEFAULT now(),
  email_factures text, email_rapports text, email_communications text,
  syndic_id_ref uuid, lat numeric, lng numeric
);

CREATE TABLE IF NOT EXISTS public.interventions (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  ref text NOT NULL,
  syndic_id uuid, acp_id uuid, technicien_id uuid,
  type intervention_type NOT NULL,
  description text, adresse text,
  statut intervention_statut NOT NULL DEFAULT 'nouvelle'::intervention_statut,
  priorite intervention_priorite NOT NULL DEFAULT 'normale'::intervention_priorite,
  date_demande date NOT NULL DEFAULT CURRENT_DATE,
  creneau_debut timestamptz, creneau_fin timestamptz,
  nom_facturation text, email_facturation text, bce_facturation text, ref_bon_commande text,
  drive_folder_id text, drive_folder_url text,
  suspens_motif text, suspens_retour date,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  started_at timestamptz, ended_at timestamptz,
  demandeur_type text, particulier_contact jsonb,
  source text DEFAULT 'portail'::text, source_mail_id text,
  color text, reference_externe text,
  organisation_id uuid, client_id uuid, delegue_id uuid,
  lat numeric, lng numeric,
  notes_tech text, action_requise text,
  assureur jsonb, appartements_concernes text[],
  deleted_at timestamptz, acp_suggestion jsonb,
  contact_telephone text, contact_email text
);

CREATE TABLE IF NOT EXISTS public.occupants (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  intervention_id uuid NOT NULL,
  appartement text NOT NULL, nom text NOT NULL,
  telephone text, email text,
  statut occupant_statut NOT NULL DEFAULT 'attente'::occupant_statut,
  token text DEFAULT encode(gen_random_bytes(24), 'hex'::text),
  token_expires timestamptz DEFAULT (now() + '7 days'::interval),
  confirmed_at timestamptz, created_at timestamptz DEFAULT now(),
  conf text DEFAULT 'en_attente'::text,
  contact_preference text DEFAULT 'email'::text,
  confirmation_token text, token_sent_at timestamptz,
  type_occupant text DEFAULT 'occupant'::text,
  etage text, instructions text, prenom text,
  erased_at timestamptz,
  proposed_creneau_debut timestamptz, proposed_creneau_fin timestamptz,
  response_note text
);

CREATE TABLE IF NOT EXISTS public.organisations (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  nom text NOT NULL,
  type user_role NOT NULL,
  contact text, email text NOT NULL, telephone text,
  bce text, agrement text, adresse text,
  created_at timestamptz DEFAULT now(),
  email_factures text, email_rapports text, email_communications text,
  lat numeric, lng numeric
);

CREATE TABLE IF NOT EXISTS public.rapports (
  intervention_id uuid NOT NULL,
  degats text DEFAULT ''::text, inspection text DEFAULT ''::text,
  conclusion text DEFAULT ''::text, recommandations text DEFAULT ''::text,
  updated_at timestamptz DEFAULT now(),
  statut text NOT NULL DEFAULT 'brouillon'::text,
  valide_par uuid, valide_at timestamptz,
  transmis_at timestamptz, transmis_a text[],
  docx_drive_url text, docx_drive_file_id text,
  pdf_drive_url text, pdf_drive_file_id text,
  genere_par_agent boolean NOT NULL DEFAULT true,
  techniques text[] NOT NULL DEFAULT '{}'::text[],
  techniques_a_confirmer text[] NOT NULL DEFAULT '{}'::text[]
);

CREATE TABLE IF NOT EXISTS public.rdv_attempts (
  id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,  -- identite auto (clause exacte inferee)
  ip text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.utilisateurs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organisation_id uuid,
  role user_role NOT NULL,
  prenom text, nom text, email text NOT NULL, telephone text,
  actif boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  couleur text, last_seen_at timestamptz
);
