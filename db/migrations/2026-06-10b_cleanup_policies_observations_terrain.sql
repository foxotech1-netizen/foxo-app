-- =============================================================================
-- 2026-06-10b — Ménage des policies observations_terrain (déjà appliquée prod)
-- =============================================================================
-- Deux policies avaient été créées directement en production via le SQL Editor
-- Supabase, hors du flux de migrations versionnées (dérive de schéma) :
--
--   - admin_all_obs : REDONDANTE avec admin_all_observations_terrain (créée par
--     la migration 2026-06-10_rls_tables_nues.sql). On la supprime pour ne
--     garder qu'une seule policy admin, versionnée.
--
--   - tech_obs : policy d'accès technicien créée en prod sans cible de rôle
--     explicite. On la réécrit en TO authenticated, à LOGIQUE STRICTEMENT
--     IDENTIQUE (un technicien accède aux observations des interventions qui
--     lui sont assignées, via la correspondance email auth.users ↔ utilisateurs).
--
-- Idempotent : DROP POLICY IF EXISTS avant le CREATE.
--
-- NOTE : cette migration a DÉJÀ été appliquée en production le 2026-06-10.
-- Ce fichier la versionne pour l'historique.
-- =============================================================================

BEGIN;

-- 1. Supprime la policy admin redondante (doublon de admin_all_observations_terrain).
DROP POLICY IF EXISTS admin_all_obs ON public.observations_terrain;

-- 2. Réécrit la policy technicien en TO authenticated (logique inchangée).
DROP POLICY IF EXISTS tech_obs ON public.observations_terrain;

CREATE POLICY tech_obs ON public.observations_terrain
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM interventions i
      JOIN utilisateurs u ON u.id = i.technicien_id
      WHERE i.id = observations_terrain.intervention_id
        AND u.email = (SELECT email FROM auth.users WHERE id = auth.uid())::text
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM interventions i
      JOIN utilisateurs u ON u.id = i.technicien_id
      WHERE i.id = observations_terrain.intervention_id
        AND u.email = (SELECT email FROM auth.users WHERE id = auth.uid())::text
    )
  );

COMMIT;
