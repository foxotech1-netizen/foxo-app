-- 2026-05-18_intervention_contact_fields.sql
-- Ajoute contact_telephone et contact_email sur interventions.
-- Contexte : confirm-and-create/route.ts (pipeline mail → intervention) les
-- remplit lors de la création d'intervention. Ces colonnes étaient attendues
-- par le code mais absentes du schéma versionné (dérive prod via Dashboard).
-- Idempotente.

ALTER TABLE public.interventions
  ADD COLUMN IF NOT EXISTS contact_telephone TEXT,
  ADD COLUMN IF NOT EXISTS contact_email TEXT;

COMMENT ON COLUMN public.interventions.contact_telephone IS
  'Téléphone du contact principal (occupant/gestionnaire). Renseigné par confirm-and-create depuis l''analyse mail.';
COMMENT ON COLUMN public.interventions.contact_email IS
  'Email du contact principal. Renseigné par confirm-and-create depuis l''analyse mail.';
