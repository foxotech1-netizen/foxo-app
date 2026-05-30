-- =========================================================
-- Migration RGPD — Étape A : marqueur d'effacement + journal
-- 2026-05-30 — idempotente, ne touche aucune donnée existante
-- Appliquée en prod le 2026-05-30 (vérif 1,1,1 OK)
-- =========================================================

-- 1. Marqueur d'anonymisation sur occupants (droit à l'oubli)
ALTER TABLE public.occupants
  ADD COLUMN IF NOT EXISTS erased_at timestamptz NULL;

COMMENT ON COLUMN public.occupants.erased_at IS
  'RGPD droit a l''oubli : horodatage de l''anonymisation des PII. NULL = donnees presentes.';

-- 2. Journal d'effacement RGPD (preuve de traitement, art. 17 RGPD)
CREATE TABLE IF NOT EXISTS public.rgpd_erasure_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occupant_id         uuid NOT NULL,
  intervention_id     uuid NULL,
  erased_by           text NOT NULL,
  erased_at           timestamptz NOT NULL DEFAULT now(),
  tables_touched      text[] NOT NULL DEFAULT '{}',
  nb_mails_anonymises integer NOT NULL DEFAULT 0,
  nb_sms_anonymises   integer NOT NULL DEFAULT 0,
  note                text NULL
);

COMMENT ON TABLE public.rgpd_erasure_logs IS
  'Journal des effacements RGPD (droit a l''oubli). Conserve APRES anonymisation comme preuve de traitement.';

-- 3. RLS : table sensible, accès admin uniquement
ALTER TABLE public.rgpd_erasure_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rgpd_erasure_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rgpd_erasure_logs_admin_all ON public.rgpd_erasure_logs;
CREATE POLICY rgpd_erasure_logs_admin_all
  ON public.rgpd_erasure_logs
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 4. Index de recherche
CREATE INDEX IF NOT EXISTS idx_rgpd_erasure_logs_occupant
  ON public.rgpd_erasure_logs (occupant_id);
CREATE INDEX IF NOT EXISTS idx_rgpd_erasure_logs_erased_at
  ON public.rgpd_erasure_logs (erased_at DESC);
