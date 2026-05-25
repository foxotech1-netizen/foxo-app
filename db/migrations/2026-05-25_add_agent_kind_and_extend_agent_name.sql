-- ============================================================
-- Migration — Chantier #7 AI Observability étendue
-- Ajoute la colonne agent_kind ('canonical' | 'utility') et
-- élargit le CHECK sur agent_name aux 4 agents utilitaires.
--
-- Date d'application en prod : 2026-05-25
-- Idempotente : peut être rejouée sans erreur.
-- ============================================================

BEGIN;

-- 1) Colonne agent_kind (default 'canonical' couvre toutes lignes pré-existantes)
ALTER TABLE public.agent_logs
  ADD COLUMN IF NOT EXISTS agent_kind text NOT NULL DEFAULT 'canonical';

-- 2) CHECK sur agent_kind (2 valeurs autorisées)
ALTER TABLE public.agent_logs
  DROP CONSTRAINT IF EXISTS agent_logs_agent_kind_check;

ALTER TABLE public.agent_logs
  ADD CONSTRAINT agent_logs_agent_kind_check
  CHECK (agent_kind = ANY (ARRAY['canonical'::text, 'utility'::text]));

-- 3) Élargir le CHECK sur agent_name : 3 canoniques + 4 utilitaires
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
    'assistant_chat'::text
  ]));

-- 4) Index sur agent_kind pour filtrer rapidement le dashboard admin
CREATE INDEX IF NOT EXISTS agent_logs_agent_kind_idx
  ON public.agent_logs (agent_kind);

COMMIT;
