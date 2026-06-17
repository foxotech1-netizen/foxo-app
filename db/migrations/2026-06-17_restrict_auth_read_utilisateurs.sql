-- =============================================================================
-- Restriction RLS : lecture de la table utilisateurs
-- Appliquee en production le 2026-06-17 via Supabase SQL Editor.
--
-- Avant : auth_read_utilisateurs USING (true)
--         -> tout compte authentifie pouvait lire TOUTE la table utilisateurs
--            (emails, telephones, roles de tous les comptes, tous tenants).
-- Apres : soi-meme + admin + meme organisation.
--
-- S'appuie sur les helpers SECURITY DEFINER existants (is_admin,
-- mon_organisation_id) qui lisent utilisateurs en contournant la RLS
-- -> aucune recursion sur la policy.
--
-- La policy admin_all_utilisateurs (FOR ALL, is_admin()) n'est PAS touchee.
--
-- Prerequis applicatif (deploye AVANT ce SQL, PR #111 / merge 03391fc) :
-- les 3 lectures cross-tenant legitimes du nom du technicien par un partenaire
-- (portal/interventions/[id], portal/interventions, buildRapportPdf) passent
-- desormais par le client service-role -> non impactees par cette restriction.
--
-- Idempotent (DROP POLICY IF EXISTS avant CREATE).
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS auth_read_utilisateurs ON public.utilisateurs;

CREATE POLICY auth_read_utilisateurs ON public.utilisateurs
  FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR is_admin()
    OR (organisation_id IS NOT NULL AND organisation_id = mon_organisation_id())
  );

COMMIT;

-- Verification post-apply (pg_policies) :
--   SELECT policyname, cmd, roles, qual
--   FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'utilisateurs'
--   ORDER BY policyname;
-- Attendu :
--   admin_all_utilisateurs | ALL    | {authenticated} | is_admin()
--   auth_read_utilisateurs | SELECT | {authenticated} | ((id = auth.uid()) OR is_admin() OR ((organisation_id IS NOT NULL) AND (organisation_id = mon_organisation_id())))
