-- Migration: align automation_jobs.action NOT NULL with prod
-- Date: 2026-05-15
--
-- Context:
--   In migration 2026-05-13_create_agent_logs_automation_jobs.sql, the
--   automation_jobs.action column was created as nullable. Production was
--   subsequently altered to NOT NULL out-of-band, creating a drift between
--   the versioned schema and production state (discovered during the
--   pre-merge audit of chantier #1 Observabilité IA).
--
--   This migration aligns the versioned schema with production so that
--   fresh-environment deployments reproduce the correct constraint.
--
-- Idempotent:
--   - The UPDATE is a no-op when action is already populated (current prod).
--   - The ALTER ... SET NOT NULL is silently accepted by Postgres when the
--     column is already NOT NULL.

-- 1) Backfill any NULL action values defensively (uses automation_name as
--    a stable fallback; matches the wrapper-level fallback added in the
--    accompanying code patch).
UPDATE public.automation_jobs
SET action = automation_name
WHERE action IS NULL;

-- 2) Enforce NOT NULL on the column.
ALTER TABLE public.automation_jobs
  ALTER COLUMN action SET NOT NULL;
