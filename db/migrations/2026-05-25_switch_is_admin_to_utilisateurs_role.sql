-- =============================================================================
-- 2026-05-25_switch_is_admin_to_utilisateurs_role.sql
-- Chantier : refacto is_admin() (étape 2.A)
--
-- Remplace la définition de is_admin() :
--   AVANT : whitelist d'emails en dur (info@foxo.be, foxotech1@gmail.com)
--   APRÈS : EXISTS sur public.utilisateurs WHERE id = auth.uid() AND role = 'admin'
--
-- Signature inchangée (boolean) → aucune des 34 policies à réécrire.
-- Atomique via CREATE OR REPLACE FUNCTION.
-- Attributs préservés : STABLE, SECURITY DEFINER, SET search_path TO 'public'.
--
-- Dépendances : nécessite que les comptes admin existent dans public.utilisateurs.
-- Voir migration 2026-05-24b_seed_admin_users.sql (exécutée en prévision).
--
-- Tests fonctionnels validés en prod 2026-05-25 :
--   - info@foxo.be → accès admin complet (dashboard, 26 interventions, etc.)
--   - tech1@foxo.be → redirigé sur app technicien, pas d'accès admin
--   - tech1@foxo.be tape /admin manuellement → middleware redirige vers /tech
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.utilisateurs
    WHERE id = auth.uid()
      AND role = 'admin'
  );
$$;
