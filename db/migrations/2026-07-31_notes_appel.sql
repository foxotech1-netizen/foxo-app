-- Notes d'appel horodatées sur la fiche client (Mode Appel phase 4).
-- DÉJÀ APPLIQUÉE en prod (Supabase) le 2026-07-31 : ce fichier assure la
-- traçabilité repo. Une note = un appel consigné depuis /admin/clients/[id],
-- rattachable optionnellement à un dossier du client.
--
-- RLS ENABLE + FORCE SANS policy : accès service-role uniquement (les
-- lectures/écritures passent par /api/admin/clients/[id]/notes, gardée admin).

CREATE TABLE IF NOT EXISTS public.notes_appel (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  intervention_id uuid REFERENCES public.interventions(id) ON DELETE SET NULL,
  contenu text NOT NULL CHECK (length(trim(contenu)) > 0),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notes_appel_client_created_idx
  ON public.notes_appel (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notes_appel_intervention_idx
  ON public.notes_appel (intervention_id)
  WHERE intervention_id IS NOT NULL;

ALTER TABLE public.notes_appel ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes_appel FORCE ROW LEVEL SECURITY;
-- Aucune policy volontairement : service-role uniquement.
