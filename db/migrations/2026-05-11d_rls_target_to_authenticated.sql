-- ============================================================
-- 2026-05-11d — RLS hardening: 5 policies "TO public" -> "TO authenticated"
-- ============================================================
-- Contexte :
--   Audit RLS du 2026-05-11 - 5 policies créées par P1
--   (2026-05-11c_rls_core_tables.sql) sont en TO public.
--   Leur USING neutralise la surface anon via les helpers
--   (mon_role, mon_organisation_id, auth.email), mais cette
--   défense est faible : un helper qui change de comportement
--   ouvrirait la surface anon.
--
-- Action :
--   Restreindre les 5 policies à TO authenticated (défense en
--   profondeur). Comportement fonctionnel inchangé pour les
--   utilisateurs authentifiés (admin / syndic / tech / courtier
--   / délégué).
--
-- Prérequis :
--   2026-05-11b_rls_core_dependencies.sql (helpers + enum)
--   2026-05-11c_rls_core_tables.sql       (création des 5 policies)
-- ============================================================

BEGIN;

ALTER POLICY acces_acps             ON public.acps          TO authenticated;
ALTER POLICY acces_interventions    ON public.interventions TO authenticated;
ALTER POLICY acces_occupants        ON public.occupants     TO authenticated;
ALTER POLICY acces_organisations    ON public.organisations TO authenticated;
ALTER POLICY delegue_select_own_org ON public.organisations TO authenticated;

COMMIT;

-- ============================================================
-- Vérification (lecture seule, hors transaction)
-- Toutes les lignes doivent montrer {authenticated} dans `roles`.
-- ============================================================
SELECT
  tablename,
  policyname,
  roles::text AS roles
FROM pg_policies
WHERE schemaname = 'public'
  AND policyname IN (
    'acces_acps',
    'acces_interventions',
    'acces_occupants',
    'acces_organisations',
    'delegue_select_own_org'
  )
ORDER BY tablename, policyname;
