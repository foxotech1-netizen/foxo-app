-- ============================================================
-- Migration — Chantier Briefing IA
-- Élargit le CHECK sur agent_logs.agent_name à l'agent utilitaire
-- 'briefing' (briefing quotidien généré pour le Tableau de bord admin).
--
-- Date d'application en prod : 2026-06-04
-- Idempotente : peut être rejouée sans erreur.
-- ============================================================

BEGIN;

-- Élargir le CHECK sur agent_name : 3 canoniques + 5 utilitaires
ALTER TABLE public.agent_logs
  DROP CONSTRAINT IF EXISTS agent_logs_agent_name_check;

ALTER TABLE public.agent_logs
  ADD CONSTRAINT agent_logs_agent_name_check
  CHECK (agent_name = ANY (ARRAY[
    -- Canoniques (doc 03)
    'triage_mail'::text,
    'analyse_pj'::text,
    'rapport'::text,
    -- Utilitaires (chantier #7)
    'draft_reply'::text,
    'sms_compose'::text,
    'notes_frais_extract'::text,
    'assistant_chat'::text,
    -- Utilitaire (chantier Briefing IA)
    'briefing'::text
  ]));

COMMIT;
