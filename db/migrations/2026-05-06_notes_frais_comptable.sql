-- Migration notes_frais : catégories comptables belges
-- Appliquée en prod le 2026-05-06

-- 1. Ajout valeurs manquantes à l'enum
ALTER TYPE categorie_note_frais ADD VALUE IF NOT EXISTS 'restaurant';
ALTER TYPE categorie_note_frais ADD VALUE IF NOT EXISTS 'cafe_client';
ALTER TYPE categorie_note_frais ADD VALUE IF NOT EXISTS 'repas_travail';
ALTER TYPE categorie_note_frais ADD VALUE IF NOT EXISTS 'reception';
ALTER TYPE categorie_note_frais ADD VALUE IF NOT EXISTS 'telephonie';
ALTER TYPE categorie_note_frais ADD VALUE IF NOT EXISTS 'formation';
ALTER TYPE categorie_note_frais ADD VALUE IF NOT EXISTS 'autre_achat';

-- 2. Colonnes comptables
ALTER TABLE public.notes_frais
  ADD COLUMN IF NOT EXISTS categorie_comptable TEXT
  CHECK (categorie_comptable IN ('professionnel', 'representation'));

ALTER TABLE public.notes_frais
  ADD COLUMN IF NOT EXISTS taux_deductibilite NUMERIC(5,2) DEFAULT 100;

-- 3. Trigger classification automatique
CREATE OR REPLACE FUNCTION public.notes_frais_set_comptable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.categorie::TEXT IN ('restaurant', 'cafe_client', 'repas_travail', 'reception', 'restauration') THEN
    NEW.categorie_comptable := 'representation';
    NEW.taux_deductibilite := 50;
  ELSE
    NEW.categorie_comptable := 'professionnel';
    NEW.taux_deductibilite := 100;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notes_frais_set_comptable ON public.notes_frais;
CREATE TRIGGER trg_notes_frais_set_comptable
  BEFORE INSERT OR UPDATE OF categorie ON public.notes_frais
  FOR EACH ROW EXECUTE FUNCTION public.notes_frais_set_comptable();

-- 4. Index
CREATE INDEX IF NOT EXISTS idx_notes_frais_categorie_comptable
  ON public.notes_frais (categorie_comptable);

NOTIFY pgrst, 'reload schema';
