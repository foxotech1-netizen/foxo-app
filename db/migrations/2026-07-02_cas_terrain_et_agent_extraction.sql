-- =============================================================================
-- Migration : 2026-07-02_cas_terrain_et_agent_extraction.sql
-- Chantier  : Assistant terrain « recherche de fuite » — Étape 1 (socle données)
-- Réf       : NOTE_CONCEPTION_Assistant_Terrain v0.3 (§4 fiche 7 blocs, §11 socle)
-- Objet     : 1) Table public.cas_terrain — une fiche normalisée par rapport
--                historique, anonymisée, décorrélée des dossiers (aucun lien
--                vers interventions : connaissance métier partagée).
--             2) Élargir agent_logs.agent_name à l'agent 'extraction_cas'
--                (doit exister AVANT le déploiement du code d'extraction, sinon
--                runAgent perd silencieusement son log — cf. 2026-06-16).
-- Idempot.  : Sûre à rejouer (IF NOT EXISTS, DROP POLICY IF EXISTS, DROP/ADD).
-- Statut    : Appliquée en prod (Supabase SQL Editor) le 2026-07-02.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) TABLE cas_terrain — la fiche normalisée (cf. NOTE_CONCEPTION §4)
--    Contenu 100 % anonymisé. Blocs riches en jsonb.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cas_terrain (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_ref         text        NOT NULL UNIQUE,
  annee              integer,
  qualite_source     text        CHECK (qualite_source IS NULL OR qualite_source = ANY (ARRAY['riche'::text,'partielle'::text,'maigre'::text])),
  statut_fuite       text        CHECK (statut_fuite  IS NULL OR statut_fuite  = ANY (ARRAY['trouvee'::text,'presumee'::text,'non_trouvee'::text])),

  contexte           jsonb,
  symptome           jsonb,
  symptome_resume    text,
  techniques         jsonb,
  raisonnement       jsonb,
  conclusion         jsonb,
  recommandation     jsonb,
  preuves_visuelles  jsonb,

  confiance          jsonb,
  extrait_par        text,
  a_relire           boolean     NOT NULL DEFAULT false,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cas_terrain ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cas_terrain FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_select ON public.cas_terrain;
CREATE POLICY admin_select
  ON public.cas_terrain
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE INDEX IF NOT EXISTS idx_cas_terrain_annee
  ON public.cas_terrain (annee);
CREATE INDEX IF NOT EXISTS idx_cas_terrain_statut
  ON public.cas_terrain (statut_fuite)
  WHERE statut_fuite IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cas_terrain_a_relire
  ON public.cas_terrain (a_relire)
  WHERE a_relire = true;

-- -----------------------------------------------------------------------------
-- 2) Élargir agent_logs.agent_name à 'extraction_cas' (motif robuste 2026-06-20)
-- -----------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class      rel ON rel.oid = con.conrelid
    JOIN pg_namespace  nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'agent_logs'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%agent_name%'
  LOOP
    EXECUTE format('ALTER TABLE public.agent_logs DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.agent_logs
  ADD CONSTRAINT agent_logs_agent_name_check
  CHECK (agent_name = ANY (ARRAY[
    'triage_mail'::text,
    'analyse_pj'::text,
    'rapport'::text,
    'analyse_photo'::text,
    'draft_reply'::text,
    'sms_compose'::text,
    'notes_frais_extract'::text,
    'assistant_chat'::text,
    'briefing'::text,
    'synthese_essentiel'::text,
    'extraction_cas'::text
  ]));

COMMIT;
