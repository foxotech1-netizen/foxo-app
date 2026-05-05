ALTER TABLE public.notes_frais
  DROP CONSTRAINT IF EXISTS notes_frais_categorie_check;

ALTER TABLE public.notes_frais
  ADD CONSTRAINT notes_frais_categorie_check
  CHECK (categorie IN (
    'carburant', 'materiel', 'outillage', 'transport',
    'restauration', 'fournitures', 'sous_traitance', 'autre',
    'restaurant', 'cafe_client', 'repas_travail', 'reception',
    'telephonie', 'formation', 'autre_achat'
  ));

ALTER TABLE public.notes_frais
  ADD COLUMN IF NOT EXISTS categorie_comptable TEXT
  CHECK (categorie_comptable IN ('professionnel', 'representation'));

ALTER TABLE public.notes_frais
  ADD COLUMN IF NOT EXISTS taux_deductibilite NUMERIC(4,2) DEFAULT 100;

CREATE OR REPLACE FUNCTION public.notes_frais_set_comptable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.categorie IN ('restaurant', 'cafe_client', 'repas_travail', 'reception', 'restauration') THEN
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

UPDATE public.notes_frais
SET categorie_comptable = CASE
    WHEN categorie IN ('restaurant', 'cafe_client', 'repas_travail', 'reception', 'restauration')
      THEN 'representation'
    ELSE 'professionnel'
  END,
  taux_deductibilite = CASE
    WHEN categorie IN ('restaurant', 'cafe_client', 'repas_travail', 'reception', 'restauration')
      THEN 50
    ELSE 100
  END
WHERE categorie_comptable IS NULL OR taux_deductibilite IS NULL;

CREATE INDEX IF NOT EXISTS idx_notes_frais_categorie_comptable
  ON public.notes_frais (categorie_comptable);

NOTIFY pgrst, 'reload schema';
