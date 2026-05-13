-- =============================================================================
-- 2026-05-11 — RLS core dependencies (P2)
-- =============================================================================
-- Versionne les dépendances de la migration 2026-05-11c_rls_core_tables.sql.
-- Capturé depuis l'état production le 2026-05-11.
--
-- Contenu :
--   1. Enum public.user_role (12 valeurs)
--   2. Table public.dossiers_sinistres (9 colonnes, 1 PK, 2 FK, 1 UNIQUE)
--   3. 14 fonctions helpers RLS (toutes SECURITY DEFINER)
--   4. ENABLE + FORCE ROW LEVEL SECURITY sur public.dossiers_sinistres
--   5. 4 policies RLS sur public.dossiers_sinistres
--
-- Particularités à connaître :
--   - mon_role() et mon_organisation_id() sont moins durcies que les autres
--     fonctions (pas de STABLE, pas de SET search_path TO 'public', pas de
--     préfixe public. sur les tables) : capturé tel quel, à durcir dans un
--     sprint sécurité dédié.
--   - is_admin() contient les emails admin en dur : pragmatique mais à
--     refactorer un jour vers une table admins / un attribut.
--   - dossiers_sinistres passe en FORCE ROW LEVEL SECURITY pour cohérence
--     avec les 9 tables de la migration P1 (2026-05-11c).
--
-- Dépendances externes (doivent préexister) :
--   - Extension "uuid-ossp" (pour uuid_generate_v4())
--   - Tables public.organisations, public.interventions, public.utilisateurs
--     (référencées par les FK et le corps des fonctions)
--   - Rôles Supabase : authenticated, public
--   - Fonctions Supabase : auth.uid(), auth.email()
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Extension préalable (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Enum public.user_role (12 valeurs)
-- ─────────────────────────────────────────────────────────────────────────────
-- CREATE TYPE n'a pas IF NOT EXISTS → wrap dans un DO block idempotent.

DO $$ BEGIN
  CREATE TYPE public.user_role AS ENUM (
    'admin',
    'syndic',
    'courtier',
    'technicien',
    'assurance',
    'expert',
    'entrepreneur',
    'plombier',
    'electricien',
    'toiturier',
    'chauffagiste',
    'autre_metier'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Table public.dossiers_sinistres
-- ─────────────────────────────────────────────────────────────────────────────
-- Liaison N..N entre une intervention et un courtier (chaque courtier peut
-- avoir son dossier sur la même intervention, d'où la UNIQUE composite).
-- CREATE TABLE IF NOT EXISTS : skip si la table existe déjà (prod).

CREATE TABLE IF NOT EXISTS public.dossiers_sinistres (
  id              uuid NOT NULL DEFAULT uuid_generate_v4(),
  intervention_id uuid NOT NULL,
  courtier_id     uuid NOT NULL,
  numero          text NOT NULL DEFAULT ''::text,
  ref_courtier    text,
  assure          text,
  date_ouverture  date,
  notes           text,
  created_at      timestamp with time zone DEFAULT now(),
  CONSTRAINT dossiers_sinistres_pkey
    PRIMARY KEY (id),
  CONSTRAINT dossiers_sinistres_intervention_id_courtier_id_key
    UNIQUE (intervention_id, courtier_id),
  CONSTRAINT dossiers_sinistres_courtier_id_fkey
    FOREIGN KEY (courtier_id) REFERENCES public.organisations(id),
  CONSTRAINT dossiers_sinistres_intervention_id_fkey
    FOREIGN KEY (intervention_id) REFERENCES public.interventions(id) ON DELETE CASCADE
);


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Fonctions helpers RLS (14 fonctions, ordre alphabétique)
-- ─────────────────────────────────────────────────────────────────────────────
-- Toutes en CREATE OR REPLACE → idempotent par construction.

-- ── acp_visible_to_partner ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.acp_visible_to_partner(p_acp_id uuid, p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.interventions iv
    where iv.acp_id = p_acp_id
      and (iv.syndic_id = p_org_id
           or exists (select 1 from public.dossiers_sinistres ds
                      where ds.intervention_id = iv.id and ds.courtier_id = p_org_id))
  );
$function$;

-- ── acp_visible_to_tech ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.acp_visible_to_tech(p_acp_id uuid, p_tech_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.interventions iv
                 where iv.acp_id = p_acp_id and iv.technicien_id = p_tech_id);
$function$;

-- ── current_org_id ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select id from public.organisations
  where lower(email) = lower(coalesce(auth.email(), ''))
  limit 1;
$function$;

-- ── current_utilisateur_id ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.current_utilisateur_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select id from public.utilisateurs
  where lower(email) = lower(coalesce(auth.email(), ''))
  limit 1;
$function$;

-- ── intervention_rapport_publie ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.intervention_rapport_publie(p_intervention_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.interventions
                 where id = p_intervention_id and statut in ('rapport','cloturee'));
$function$;

-- ── is_admin ─────────────────────────────────────────────────────────────────
-- NOTE : emails admin en dur, à refactorer un jour vers une table dédiée.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select coalesce(
    auth.email() = any(array['info@foxo.be','foxotech1@gmail.com']::text[]),
    false
  );
$function$;

-- ── is_partner ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_partner()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$ select public.current_org_id() is not null; $function$;

-- ── is_tech ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_tech()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$ select public.current_utilisateur_id() is not null; $function$;

-- ── mon_organisation_id ──────────────────────────────────────────────────────
-- NOTE : moins durcie que les autres (pas de STABLE, pas de SET search_path,
-- pas de préfixe public.). Capturé tel quel — à harmoniser dans un sprint
-- sécurité dédié.
CREATE OR REPLACE FUNCTION public.mon_organisation_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
AS $function$
  select organisation_id from utilisateurs where id = auth.uid();
$function$;

-- ── mon_role ─────────────────────────────────────────────────────────────────
-- NOTE : idem mon_organisation_id, faiblesse de search_path. À harmoniser.
CREATE OR REPLACE FUNCTION public.mon_role()
RETURNS user_role
LANGUAGE sql
SECURITY DEFINER
AS $function$
  select role from utilisateurs where id = auth.uid();
$function$;

-- ── org_in_dossier ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_in_dossier(p_intervention_id uuid, p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.dossiers_sinistres
                 where intervention_id = p_intervention_id and courtier_id = p_org_id);
$function$;

-- ── org_owns_intervention ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_owns_intervention(p_intervention_id uuid, p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.interventions
                 where id = p_intervention_id and syndic_id = p_org_id);
$function$;

-- ── partner_can_access_intervention ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.partner_can_access_intervention(p_intervention_id uuid, p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select public.org_owns_intervention(p_intervention_id, p_org_id)
      or public.org_in_dossier(p_intervention_id, p_org_id);
$function$;

-- ── tech_owns_intervention ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tech_owns_intervention(p_intervention_id uuid, p_tech_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.interventions
                 where id = p_intervention_id and technicien_id = p_tech_id);
$function$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS state + policies sur public.dossiers_sinistres
-- ─────────────────────────────────────────────────────────────────────────────
-- 4 policies au total, FORCE activé (cohérence avec migration P1).

ALTER TABLE public.dossiers_sinistres ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dossiers_sinistres FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS acces_dossiers ON public.dossiers_sinistres;
CREATE POLICY acces_dossiers ON public.dossiers_sinistres
  FOR SELECT
  TO public
  USING (((mon_role() = 'admin'::user_role) OR (courtier_id = mon_organisation_id())));

DROP POLICY IF EXISTS admin_all_dossiers ON public.dossiers_sinistres;
CREATE POLICY admin_all_dossiers ON public.dossiers_sinistres
  FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS courtier_select_own_dossiers ON public.dossiers_sinistres;
CREATE POLICY courtier_select_own_dossiers ON public.dossiers_sinistres
  FOR SELECT
  TO authenticated
  USING ((courtier_id = current_org_id()));

DROP POLICY IF EXISTS tech_select_dossiers ON public.dossiers_sinistres;
CREATE POLICY tech_select_dossiers ON public.dossiers_sinistres
  FOR SELECT
  TO authenticated
  USING (tech_owns_intervention(intervention_id, current_utilisateur_id()));


-- =============================================================================
-- Vérifications post-apply (à exécuter manuellement après COMMIT)
-- =============================================================================
-- 1. Enum présent avec 12 valeurs :
--    SELECT array_agg(enumlabel ORDER BY enumsortorder)
--    FROM pg_enum WHERE enumtypid = 'public.user_role'::regtype;
--
-- 2. Table dossiers_sinistres présente avec ses 4 contraintes :
--    SELECT conname, contype FROM pg_constraint
--    WHERE conrelid = 'public.dossiers_sinistres'::regclass ORDER BY conname;
--    → doit retourner 4 lignes (1 PK 'p', 2 FK 'f', 1 UNIQUE 'u')
--
-- 3. 14 fonctions présentes :
--    SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public' AND p.proname IN (
--      'mon_role','mon_organisation_id','is_admin','is_partner','is_tech',
--      'current_org_id','current_utilisateur_id',
--      'acp_visible_to_partner','acp_visible_to_tech',
--      'org_in_dossier','org_owns_intervention',
--      'partner_can_access_intervention','tech_owns_intervention',
--      'intervention_rapport_publie'
--    );
--    → doit retourner 14.
--
-- 4. RLS + FORCE actif sur dossiers_sinistres :
--    SELECT relrowsecurity, relforcerowsecurity FROM pg_class
--    WHERE oid = 'public.dossiers_sinistres'::regclass;
--    → doit retourner (true, true)
--
-- 5. 4 policies présentes :
--    SELECT count(*) FROM pg_policies
--    WHERE schemaname='public' AND tablename='dossiers_sinistres';
--    → doit retourner 4.
-- =============================================================================

COMMIT;
