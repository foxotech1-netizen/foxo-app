-- Recherche par téléphone (Mode Appel) — colonne générée chiffres seuls.
-- DÉJÀ APPLIQUÉE en prod (Supabase) le 2026-07-30 : ce fichier assure la
-- traçabilité repo. occupants.telephone est du texte libre non normalisé
-- (cf. audit 2026-07-30) ; telephone_digits permet un ILIKE stable côté
-- /api/admin/search quel que soit le formatage saisi.

ALTER TABLE occupants
  ADD COLUMN IF NOT EXISTS telephone_digits text
  GENERATED ALWAYS AS (regexp_replace(coalesce(telephone, ''), '\D', '', 'g')) STORED;

CREATE INDEX IF NOT EXISTS occupants_telephone_digits_idx
  ON occupants (telephone_digits)
  WHERE telephone_digits <> '';
