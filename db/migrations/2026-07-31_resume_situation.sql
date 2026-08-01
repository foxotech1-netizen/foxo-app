-- ============================================================
-- Migration — Agent `resume_situation` (Mode Appel phase 5)
--   1) Élargir agent_logs.agent_name à 'resume_situation' (13 valeurs)
--   2) clients.resume_ia + clients.resume_ia_genere_le (cache du résumé)
--
-- Contexte : bouton « Résumer la situation » (IA) sur la fiche client 360°.
-- L'agent est émis via runAgent → doit être autorisé par le CHECK
-- agent_name, sinon son log agent_logs est silencieusement perdu
-- (runAgent avale les erreurs d'insertion — piège connu).
--
-- DÉJÀ APPLIQUÉE en prod (Supabase SQL Editor) le 2026-07-31 : ce
-- fichier assure la traçabilité repo. Idempotente.
-- ============================================================
BEGIN;

-- 1) Supprimer TOUTE contrainte CHECK portant sur agent_name (boucle robuste)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class      rel ON rel.oid = con.conrelid
    JOIN pg_namespace  nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'agent_logs'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%agent_name%'
  LOOP
    EXECUTE format('ALTER TABLE public.agent_logs DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- 2) Recréer le CHECK : 4 canoniques + 9 utilitaires (ajout resume_situation)
ALTER TABLE public.agent_logs
  ADD CONSTRAINT agent_logs_agent_name_check
  CHECK (agent_name = ANY (ARRAY[
    -- Canoniques (doc 03)
    'triage_mail'::text,
    'analyse_pj'::text,
    'rapport'::text,
    'analyse_photo'::text,
    -- Utilitaires
    'draft_reply'::text,
    'sms_compose'::text,
    'notes_frais_extract'::text,
    'assistant_chat'::text,
    'briefing'::text,
    'synthese_essentiel'::text,
    'extraction_cas'::text,
    'extraction_achat'::text,
    'resume_situation'::text
  ]));

-- 3) Cache du résumé IA sur la fiche client
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS resume_ia text;
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS resume_ia_genere_le timestamptz;

COMMIT;
