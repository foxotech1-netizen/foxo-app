-- =============================================================================
-- 2026-06-10 — RLS sur les 4 tables "nues" (déjà appliquée en prod)
-- =============================================================================
-- Suite à l'audit de sécurité 2026-06-10 (docs/audits/2026-06-10_audit_securite.md,
-- constat CRITIQUE #1) : ces 4 tables étaient dans le schéma `public` sans
-- ENABLE ROW LEVEL SECURITY ni policy, donc potentiellement exposées via
-- PostgREST aux rôles anon/authenticated.
--
-- Tables couvertes :
--   - mails_analyses        (analyses IA des emails entrants — PII)
--   - intervention_mails    (métadonnées / snippets d'emails par dossier)
--   - intervention_liens    (liens entre dossiers)
--   - observations_terrain  (relevés terrain technicien)
--
-- Politique : ENABLE + FORCE ROW LEVEL SECURITY (cohérent avec les tables cœur),
-- puis une policy admin_all_<table> FOR ALL TO authenticated USING is_admin().
-- Ces tables ne sont consommées que par des routes admin / crons qui passent par
-- le client service-role (BYPASSRLS natif) — l'ajout des policies ne casse donc
-- aucun flux applicatif.
--
-- Idempotent : ENABLE/FORCE sont sans effet si déjà actifs ; DROP POLICY IF
-- EXISTS avant chaque CREATE POLICY.
--
-- NOTE : cette migration a DÉJÀ été appliquée en production via le SQL Editor
-- Supabase le 2026-06-10. Ce fichier la versionne pour l'historique.
-- =============================================================================

BEGIN;

-- ── mails_analyses ───────────────────────────────────────────────────────────
ALTER TABLE public.mails_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mails_analyses FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_all_mails_analyses ON public.mails_analyses;
CREATE POLICY admin_all_mails_analyses ON public.mails_analyses
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ── intervention_mails ───────────────────────────────────────────────────────
ALTER TABLE public.intervention_mails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intervention_mails FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_all_intervention_mails ON public.intervention_mails;
CREATE POLICY admin_all_intervention_mails ON public.intervention_mails
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ── intervention_liens ───────────────────────────────────────────────────────
ALTER TABLE public.intervention_liens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intervention_liens FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_all_intervention_liens ON public.intervention_liens;
CREATE POLICY admin_all_intervention_liens ON public.intervention_liens
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ── observations_terrain ─────────────────────────────────────────────────────
ALTER TABLE public.observations_terrain ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.observations_terrain FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_all_observations_terrain ON public.observations_terrain;
CREATE POLICY admin_all_observations_terrain ON public.observations_terrain
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

COMMIT;
