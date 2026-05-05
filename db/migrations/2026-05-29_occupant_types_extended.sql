-- 2026-05-29_occupant_types_extended.sql
--
-- Étend la liste des valeurs autorisées pour public.occupants.type_occupant
-- au-delà des 3 valeurs initiales (cf. 2026-05-17_intervention_delegue.sql).
-- Sources d'occupants pris en charge :
--   - occupant         : résident principal (défaut)
--   - proprietaire     : propriétaire bailleur (ne réside pas)
--   - locataire        : locataire identifié distinct du résident
--   - concierge        : conciergerie / loge
--   - voisin           : voisinage averti pour accès / nuisance
--   - gestionnaire     : gestionnaire d'immeuble / régie
--   - parties_communes : zone commune sans résident (escaliers, hall…)
--   - autre            : non typé / fallback
--
-- Compat : on remplace le CHECK existant sans toucher aux données ;
-- les rows historiques 'occupant' / 'proprietaire' / 'parties_communes'
-- restent valides.

ALTER TABLE public.occupants
  DROP CONSTRAINT IF EXISTS occupants_type_occupant_check;

ALTER TABLE public.occupants
  ADD CONSTRAINT occupants_type_occupant_check
  CHECK (type_occupant IN (
    'occupant', 'proprietaire', 'locataire', 'concierge',
    'voisin', 'gestionnaire', 'parties_communes', 'autre'
  ));

NOTIFY pgrst, 'reload schema';
