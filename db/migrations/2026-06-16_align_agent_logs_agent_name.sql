-- ============================================================
-- Migration — Alignement agent_logs.agent_name sur le code (type AgentName)
-- Chantier : Observabilité IA (audit 2026-06-16)
--
-- Contexte : le CHECK agent_name de PROD avait dérivé du code. Il autorisait
-- une convention périmée (calendar_suggest / sms_draft / email_draft) et
-- refusait 4 agents réellement émis par le code (analyse_photo, draft_reply,
-- sms_compose, notes_frais_extract). Le wrapper runAgent avalant les erreurs
-- d'insertion, ces 4 agents perdaient SILENCIEUSEMENT leurs logs agent_logs
-- (exigence doc 02 §10 non satisfaite pour eux).
--
-- Effet : aligne le CHECK sur les 9 valeurs exactes de
-- src/lib/observability/agent-logger.ts (type AgentName).
--
-- Date d'application en prod (Supabase SQL Editor) : 2026-06-16
-- Idempotente. Schéma uniquement, aucune donnée touchée
-- (aucune ligne n'utilisait les valeurs retirées).
-- ============================================================
BEGIN;

-- 1) Supprimer TOUTE contrainte CHECK portant sur agent_name
--    (le nom exact en prod était non canonique -> boucle robuste)
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

-- 2) Recréer le CHECK canonique : exactement les 9 valeurs de AgentName
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
    'briefing'::text
  ]));

COMMIT;
