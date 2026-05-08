-- Légende libre par photo, affichée sous chaque miniature dans le rapport
-- (RapportPanel) et dans la modale Aperçu. Auto-save côté tech via debounce
-- 800ms. NULL = pas de légende (état initial à l'upload).
--
-- Idempotent : `add column if not exists` permet de relancer la migration
-- sans effet sur les bases déjà migrées.

alter table public.photos_interventions
  add column if not exists label text;
