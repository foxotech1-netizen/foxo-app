-- ============================================================================
-- Migration 2026-05-16 — Création des tables relances / notifications / attachments
-- ============================================================================
-- Chantier #2 : combler le schéma cible (doc 04) avec les 3 tables manquantes.
-- Appliquée en production le 2026-05-24.
-- Convention : FORCE ROW LEVEL SECURITY, policies TO authenticated, idempotent.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Fonction utilitaire (idempotente) : trigger BEFORE UPDATE pour updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.foxo_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- ===========================================================================
-- Table : attachments
-- Pièces jointes archivées depuis mails ou interventions (cf. doc 04).
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intervention_id uuid NULL REFERENCES public.interventions(id) ON DELETE CASCADE,
  email_id uuid NULL, -- pas de FK : table emails non créée à ce jour
  original_filename text NOT NULL,
  new_filename text NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  drive_url text NULL,
  drive_file_id text NULL,
  type_detecte text NULL CHECK (type_detecte IS NULL OR type_detecte = ANY (ARRAY[
    'declaration_sinistre','pv_constat','photo_degat','devis',
    'rapport_tiers','courrier','autre'
  ])),
  target_folder text NULL,
  extracted_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_summary text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "attachments_admin_all" ON public.attachments;
CREATE POLICY "attachments_admin_all" ON public.attachments
  FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE INDEX IF NOT EXISTS attachments_intervention_id_idx
  ON public.attachments (intervention_id) WHERE intervention_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS attachments_email_id_idx
  ON public.attachments (email_id) WHERE email_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS attachments_type_detecte_idx
  ON public.attachments (type_detecte) WHERE type_detecte IS NOT NULL;

CREATE INDEX IF NOT EXISTS attachments_deleted_at_idx
  ON public.attachments (deleted_at) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS attachments_set_updated_at ON public.attachments;
CREATE TRIGGER attachments_set_updated_at
  BEFORE UPDATE ON public.attachments
  FOR EACH ROW EXECUTE FUNCTION public.foxo_set_updated_at();


-- ===========================================================================
-- Table : notifications
-- Alertes pour utilisateurs admin (et plus tard syndics, techniciens).
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destinataire_id uuid NOT NULL REFERENCES public.utilisateurs(id) ON DELETE CASCADE,
  intervention_id uuid NULL REFERENCES public.interventions(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type = ANY (ARRAY[
    'urgence','confirmation_recue','validation_requise','agent_alerte','info'
  ])),
  titre text NOT NULL,
  message text NOT NULL,
  lien text NULL,
  lu boolean NOT NULL DEFAULT false,
  lu_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_destinataire_select" ON public.notifications;
CREATE POLICY "notifications_destinataire_select" ON public.notifications
  FOR SELECT
  TO authenticated
  USING (is_admin() OR destinataire_id = auth.uid());

DROP POLICY IF EXISTS "notifications_destinataire_update" ON public.notifications;
CREATE POLICY "notifications_destinataire_update" ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (is_admin() OR destinataire_id = auth.uid())
  WITH CHECK (is_admin() OR destinataire_id = auth.uid());

DROP POLICY IF EXISTS "notifications_admin_insert" ON public.notifications;
CREATE POLICY "notifications_admin_insert" ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS "notifications_admin_delete" ON public.notifications;
CREATE POLICY "notifications_admin_delete" ON public.notifications
  FOR DELETE
  TO authenticated
  USING (is_admin());

CREATE INDEX IF NOT EXISTS notifications_destinataire_lu_idx
  ON public.notifications (destinataire_id, lu, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_type_idx
  ON public.notifications (type, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_intervention_id_idx
  ON public.notifications (intervention_id) WHERE intervention_id IS NOT NULL;


-- ===========================================================================
-- Table : relances
-- Journal des relances envoyées (confirmation occupant, paiement, etc).
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.relances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intervention_id uuid NULL REFERENCES public.interventions(id) ON DELETE CASCADE,
  facture_id uuid NULL REFERENCES public.factures(id) ON DELETE CASCADE,
  occupant_id uuid NULL REFERENCES public.occupants(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type = ANY (ARRAY[
    'confirmation_occupant','paiement','transmission_rapport'
  ])),
  niveau integer NOT NULL CHECK (niveau >= 1 AND niveau <= 5),
  canal text NOT NULL CHECK (canal = ANY (ARRAY[
    'email','sms','appel_telephonique'
  ])),
  langue text NOT NULL,
  contenu text NOT NULL,
  envoye_at timestamptz NOT NULL DEFAULT now(),
  efficacite text NULL CHECK (efficacite IS NULL OR efficacite = ANY (ARRAY[
    'confirme','paye','pas_de_reponse','refuse'
  ])),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (intervention_id IS NOT NULL OR facture_id IS NOT NULL OR occupant_id IS NOT NULL)
);

ALTER TABLE public.relances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relances FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "relances_admin_all" ON public.relances;
CREATE POLICY "relances_admin_all" ON public.relances
  FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE INDEX IF NOT EXISTS relances_intervention_id_idx
  ON public.relances (intervention_id) WHERE intervention_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS relances_facture_id_idx
  ON public.relances (facture_id) WHERE facture_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS relances_occupant_id_idx
  ON public.relances (occupant_id) WHERE occupant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS relances_type_envoye_at_idx
  ON public.relances (type, envoye_at DESC);

DROP TRIGGER IF EXISTS relances_set_updated_at ON public.relances;
CREATE TRIGGER relances_set_updated_at
  BEFORE UPDATE ON public.relances
  FOR EACH ROW EXECUTE FUNCTION public.foxo_set_updated_at();

COMMIT;
