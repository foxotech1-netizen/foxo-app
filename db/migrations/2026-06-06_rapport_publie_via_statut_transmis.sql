-- 2026-06-06 — Visibilité partenaire du rapport basée sur rapports.statut='transmis'
--
-- Contexte : depuis l'Étape 3, publishRapport pose interventions.statut='rapport'
-- mais rapports.statut='brouillon' (sans envoi). L'ancienne définition de
-- intervention_rapport_publie() testait interventions.statut IN ('rapport','cloturee'),
-- exposant donc des brouillons non validés au portail syndic.
--
-- Fix : le rapport n'est "publié" que lorsqu'il est réellement transmis.
-- Idempotent (CREATE OR REPLACE). Aucune policy à recréer : la policy
-- partner_select_published_rapports appelle déjà ce helper.
--
-- SECURITY DEFINER obligatoire : la fonction lit rapports et est utilisée dans
-- la policy RLS de rapports ; sans DEFINER -> récursion infinie.

CREATE OR REPLACE FUNCTION public.intervention_rapport_publie(p_intervention_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.rapports
    WHERE intervention_id = p_intervention_id
      AND statut = 'transmis'
  );
$$;
