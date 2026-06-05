-- =====================================================================
-- Étape 3 — Rapport : suivi d'état en base
-- Ajoute statut, validation admin, transmission, liens Drive.
-- Idempotent (réexécutable sans risque). À exécuter dans Supabase SQL Editor.
-- =====================================================================

ALTER TABLE public.rapports ADD COLUMN IF NOT EXISTS statut text;

UPDATE public.rapports r
SET statut = 'transmis'
FROM public.interventions i
WHERE r.intervention_id = i.id
  AND i.statut IN ('rapport', 'cloturee')
  AND r.statut IS NULL;

UPDATE public.rapports SET statut = 'brouillon' WHERE statut IS NULL;

ALTER TABLE public.rapports ALTER COLUMN statut SET DEFAULT 'brouillon';
ALTER TABLE public.rapports ALTER COLUMN statut SET NOT NULL;

ALTER TABLE public.rapports DROP CONSTRAINT IF EXISTS rapports_statut_check;
ALTER TABLE public.rapports
  ADD CONSTRAINT rapports_statut_check
  CHECK (statut IN ('brouillon', 'valide', 'transmis'));

ALTER TABLE public.rapports ADD COLUMN IF NOT EXISTS valide_par uuid;
ALTER TABLE public.rapports ADD COLUMN IF NOT EXISTS valide_at timestamptz;

ALTER TABLE public.rapports ADD COLUMN IF NOT EXISTS transmis_at timestamptz;
ALTER TABLE public.rapports ADD COLUMN IF NOT EXISTS transmis_a text[];

ALTER TABLE public.rapports ADD COLUMN IF NOT EXISTS docx_drive_url text;
ALTER TABLE public.rapports ADD COLUMN IF NOT EXISTS docx_drive_file_id text;
ALTER TABLE public.rapports ADD COLUMN IF NOT EXISTS pdf_drive_url text;
ALTER TABLE public.rapports ADD COLUMN IF NOT EXISTS pdf_drive_file_id text;

UPDATE public.rapports
SET transmis_at = updated_at
WHERE statut = 'transmis' AND transmis_at IS NULL;

ALTER TABLE public.rapports
  ADD COLUMN IF NOT EXISTS genere_par_agent boolean NOT NULL DEFAULT true;
