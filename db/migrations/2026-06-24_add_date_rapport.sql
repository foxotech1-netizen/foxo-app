-- Ajoute une date de rapport choisie (cloture « Fait a …, le {date} »).
-- NULL = repli sur la date de generation (comportement actuel inchange).
ALTER TABLE public.rapports
  ADD COLUMN IF NOT EXISTS date_rapport date;

COMMENT ON COLUMN public.rapports.date_rapport IS
  'Date affichee dans la cloture du rapport (PDF + Word). NULL = date de generation.';
