-- ============================================================
-- Migration — Élargir agent_logs.agent_name à 'synthese_essentiel'
-- Chantier : Rapport PDF — bloc « L'essentiel » (synthèse IA)
--
-- Contexte : nouvel agent utilitaire `synthese_essentiel` qui condense
-- conclusion + recommandation en 2 phrases courtes pour la couverture du
-- rapport. Émis via runAgent → doit être autorisé par le CHECK agent_name,
-- sinon son log agent_logs est silencieusement perdu (runAgent avale les
-- erreurs d'insertion — cf. migration 2026-06-16).
--
-- Date d'application en prod (Supabase SQL Editor) : 2026-06-20
-- Idempotente. Schéma uniquement, aucune donnée touchée.
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

-- 2) Recréer le CHECK : 4 canoniques + 6 utilitaires (ajout synthese_essentiel)
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
    'synthese_essentiel'::text
  ]));

COMMIT;
