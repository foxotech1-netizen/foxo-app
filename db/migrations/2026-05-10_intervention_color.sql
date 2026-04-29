-- Couleur personnalisée d'une intervention (override de la couleur
-- automatique basée sur statut/technicien dans le planning).
-- NULL = utiliser la couleur par défaut.

alter table public.interventions
  add column if not exists color text default null;
