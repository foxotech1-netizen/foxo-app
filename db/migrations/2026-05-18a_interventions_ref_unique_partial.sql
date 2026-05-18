-- ============================================================
-- Migration : remplacement de la contrainte UNIQUE totale sur
-- interventions.ref par un INDEX UNIQUE partiel filtrant sur
-- deleted_at IS NULL.
--
-- Contexte : chantier #5 (harmonisation des refs intervention,
-- commit a162776). Avant cette migration, un soft-delete d'une
-- intervention conservait la ref bloquée à cause de la contrainte
-- UNIQUE totale, ce qui interdisait toute réutilisation de la
-- même ref. C'est un pattern Postgres standard que de filtrer
-- l'unicité sur les lignes actives.
--
-- Appliquée en prod le 2026-05-18 via Supabase SQL Editor.
-- Versionnée tardivement le 2026-05-19.
--
-- Idempotent : les deux opérations sont safe à rejouer.
-- ============================================================

ALTER TABLE public.interventions DROP CONSTRAINT IF EXISTS interventions_ref_key;

CREATE UNIQUE INDEX IF NOT EXISTS interventions_ref_unique_active
  ON public.interventions(ref)
  WHERE deleted_at IS NULL;
