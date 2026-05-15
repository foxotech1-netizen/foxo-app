-- =============================================================================
-- Migration : 2026-05-13_create_agent_logs_automation_jobs.sql
-- Objet    : Tables d'observabilité pour les appels Anthropic des agents
--            canoniques (agent_logs) et les exécutions de crons/automatisations
--            (automation_jobs).
-- Réf      : doc 02 §10 (règle de logging obligatoire des appels IA)
--            doc 03 (spec observabilité agents)
-- Statut   : Appliquée en production le 2026-05-13. Versionnée ici pour
--            traçabilité et reproductibilité sur environnement fresh.
-- Idempot. : Sûre à rejouer (CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS
--            avant CREATE POLICY, CREATE INDEX IF NOT EXISTS).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- TABLE agent_logs
-- Logs structurés de chaque appel Anthropic des 3 agents canoniques.
-- input_summary et output_summary doivent être SANS PII (cf. doc 02 §8 RGPD).
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_logs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name        text        NOT NULL
                                CHECK (agent_name IN ('triage_mail', 'analyse_pj', 'rapport')),
  intervention_id   uuid        REFERENCES public.interventions(id) ON DELETE SET NULL,
  email_id          uuid,
  input_summary     jsonb,
  output_summary    jsonb,
  model_used        text,
  tokens_input      integer,
  tokens_output     integer,
  cost_eur_cents    integer,
  duration_ms       integer,
  status            text        NOT NULL
                                CHECK (status IN ('success', 'partial', 'error')),
  error_message     text,
  confidence_score  numeric(3,2),
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_logs FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_select ON public.agent_logs;
CREATE POLICY admin_select
  ON public.agent_logs
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE INDEX IF NOT EXISTS idx_agent_logs_name_created
  ON public.agent_logs (agent_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_logs_intervention
  ON public.agent_logs (intervention_id)
  WHERE intervention_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_logs_status_created
  ON public.agent_logs (status, created_at DESC)
  WHERE status <> 'success';

CREATE INDEX IF NOT EXISTS idx_agent_logs_created
  ON public.agent_logs (created_at DESC);

-- -----------------------------------------------------------------------------
-- TABLE automation_jobs
-- Logs structurés de chaque exécution de cron / job d'automatisation
-- (rappels J+1, renew calendar watch, check-mails, etc.).
-- automation_name est texte libre (pas de CHECK strict, contrairement à agent_name).
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.automation_jobs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_name   text        NOT NULL,
  intervention_id   uuid        REFERENCES public.interventions(id) ON DELETE SET NULL,
  action            text,
  result            jsonb,
  status            text        NOT NULL
                                CHECK (status IN ('success', 'failed', 'skipped')),
  error_message     text,
  executed_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.automation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_jobs FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_select ON public.automation_jobs;
CREATE POLICY admin_select
  ON public.automation_jobs
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE INDEX IF NOT EXISTS idx_automation_jobs_name_executed
  ON public.automation_jobs (automation_name, executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_jobs_intervention
  ON public.automation_jobs (intervention_id)
  WHERE intervention_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_automation_jobs_status_executed
  ON public.automation_jobs (status, executed_at DESC)
  WHERE status <> 'success';

CREATE INDEX IF NOT EXISTS idx_automation_jobs_executed
  ON public.automation_jobs (executed_at DESC);

COMMIT;
