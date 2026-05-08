-- Module « Observations terrain » du rapport tech : structure les
-- constatations et tests menés sur site (test colorant, mise en pression,
-- thermographie, etc.) avec localisation (étage / pièce) et notes libres.
-- Chaque observation peut être liée à une ou plusieurs photos via
-- photos_interventions.observation_id (set null on delete pour
-- conserver les photos en cas de suppression d'une observation).
--
-- Idempotent : peut être réappliquée sans effet (already-applied en prod).

CREATE TABLE IF NOT EXISTS observations_terrain (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intervention_id uuid NOT NULL REFERENCES interventions(id) ON DELETE CASCADE,
  test_type text NOT NULL,
  etage text,
  localisation text,
  notes text,
  ordre integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_obs_terrain_intervention
  ON observations_terrain(intervention_id);

ALTER TABLE photos_interventions
  ADD COLUMN IF NOT EXISTS observation_id uuid
    REFERENCES observations_terrain(id) ON DELETE SET NULL;
