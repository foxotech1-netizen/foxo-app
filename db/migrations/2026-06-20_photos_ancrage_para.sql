-- 2026-06-20_photos_ancrage_para.sql
-- Rapport : ancrage d'une photo à un paragraphe de sa section.
-- NULL = comportement historique (photo affichée en fin de section).
-- Idempotent — réexécutable sans risque.
ALTER TABLE public.photos_interventions
  ADD COLUMN IF NOT EXISTS ancrage_para integer;

COMMENT ON COLUMN public.photos_interventions.ancrage_para IS
  'Rapport: index 1-based du paragraphe de la section que la photo illustre; rendue juste apres ce paragraphe. NULL = fin de section.';
