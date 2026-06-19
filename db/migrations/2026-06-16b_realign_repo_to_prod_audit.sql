-- ============================================================
-- 2026-06-16b — Réalignement repo -> prod (audit coherence migrations 2026-06-16)
-- ============================================================
-- Contexte : l'audit de coherence migrations <-> schema prod (2026-06-16) a
-- montre que certaines contraintes presentes EN PROD n'etaient declarees dans
-- AUCUNE migration versionnee. Cette migration ARCHIVE ces contraintes telles
-- qu'elles existent reellement en prod, pour que le repo cesse de mal decrire
-- la base. Idempotente. Si rejouee en prod : no-op (objets identiques).
--
-- AUCUNE modification de comportement : on enregistre l'existant.
-- (Categorie doc/archive : ce fichier n'est re-execute par aucun runtime.)
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) mails_analyses.type
-- La migration 2026-05-11 creait la colonne `type` en TEXT libre (commentaire
-- listant les valeurs, sans CHECK). La PROD a en realite un CHECK strict.
-- ------------------------------------------------------------
ALTER TABLE public.mails_analyses DROP CONSTRAINT IF EXISTS mails_analyses_type_check;
ALTER TABLE public.mails_analyses
  ADD CONSTRAINT mails_analyses_type_check
  CHECK (type = ANY (ARRAY[
    'demande_intervention'::text,
    'relance_rapport'::text,
    'suivi_dossier'::text,
    'question_generale'::text,
    'accuse_reception'::text,
    'spam_commercial'::text
  ]));

-- ------------------------------------------------------------
-- 2) mails_analyses.langue
-- CHECK present en prod, absent de toute migration.
-- ------------------------------------------------------------
ALTER TABLE public.mails_analyses DROP CONSTRAINT IF EXISTS mails_analyses_langue_check;
ALTER TABLE public.mails_analyses
  ADD CONSTRAINT mails_analyses_langue_check
  CHECK (langue = ANY (ARRAY['fr'::text, 'nl'::text, 'en'::text, 'other'::text]));

COMMIT;

-- ------------------------------------------------------------
-- 3) Zone "notes de frais" — DOCUMENTATION (aucune DDL appliquee)
-- ------------------------------------------------------------
-- Constat d'audit : la prod n'utilise PAS les definitions des migrations
--   - 2026-05-06_notes_frais_comptable.sql : ALTER TYPE categorie_note_frais
--     ADD VALUE (restaurant, cafe_client, repas_travail, reception, telephonie,
--     formation, autre_achat) -> ces valeurs sont ABSENTES de la prod.
--   - 2026-05-30_notes_frais.sql : declare notes_frais.categorie et
--     notes_frais.statut en TEXT + CHECK -> en prod ce sont des ENUMS.
--
-- Etat REEL en prod (releve par l'audit) :
--   - ENUM categorie_note_frais = (carburant, materiel, outillage, transport,
--     restauration, fournitures, sous_traitance, autre)
--   - ENUM statut_note_frais    = (brouillon, soumise, approuvee, rejetee, remboursee)
--   - notes_frais.categorie / notes_frais.statut utilisent ces enums (pas de CHECK).
--   - notes_frais.categorie_comptable conserve son CHECK (professionnel, representation).
--
-- Decision : on NE touche PAS aux enums prod (corrects et utilises ; les recreer
-- serait risque et inutile). Ce bloc documente l'ecart pour la tracabilite.
-- Les valeurs emises par le code actuel correspondent a la prod.
-- ============================================================
