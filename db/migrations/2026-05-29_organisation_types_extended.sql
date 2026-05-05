-- 2026-05-29_organisation_types_extended.sql
--
-- Étend la liste des types d'organisations pour couvrir les nouveaux
-- partenaires (assurance, expert) et les corps de métier (sous-
-- traitants techniques sollicités sur intervention).
--
-- Avant : 'syndic' | 'courtier'
-- Après : + 'assurance' | 'expert' | 'entrepreneur' | 'plombier'
--         | 'electricien' | 'toiturier' | 'chauffagiste' | 'autre_metier'
--
-- Compat : les rows existantes ('syndic', 'courtier') restent valides.

ALTER TABLE public.organisations
  DROP CONSTRAINT IF EXISTS organisations_type_check;

ALTER TABLE public.organisations
  ADD CONSTRAINT organisations_type_check
  CHECK (type IN (
    'syndic','courtier','assurance','expert',
    'entrepreneur','plombier','electricien',
    'toiturier','chauffagiste','autre_metier'
  ));

NOTIFY pgrst, 'reload schema';
