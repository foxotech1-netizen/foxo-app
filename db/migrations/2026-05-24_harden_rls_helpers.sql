-- =============================================================================
-- Chantier #3 — Hardening RLS helpers (Postgres SECURITY DEFINER best practice)
-- Appliquée en production le 2026-05-24.
--
-- Ajoute STABLE + SET search_path TO 'public' sur les helpers mon_role() et
-- mon_organisation_id() qui étaient SECURITY DEFINER sans search_path figé
-- (vulnérabilité d'élévation de privilèges Postgres connue : un schéma
-- attaquant aurait pu shadower la table utilisateurs).
--
-- Préfixe également la table utilisateurs avec public. dans le corps des
-- fonctions, pour ne plus dépendre de la résolution par search_path.
--
-- Pattern de référence : current_utilisateur_id() (migration 2026-05-11b).
-- is_admin() est déjà conforme et n'est pas touchée.
--
-- Idempotent (CREATE OR REPLACE FUNCTION). Aucune destruction.
-- Aucune policy modifiée — la signature et le type de retour des fonctions
-- restent identiques.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. mon_organisation_id()
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mon_organisation_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select organisation_id from public.utilisateurs where id = auth.uid();
$function$;

-- -----------------------------------------------------------------------------
-- 2. mon_role()
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mon_role()
RETURNS public.user_role
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select role from public.utilisateurs where id = auth.uid();
$function$;
