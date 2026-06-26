-- Annotations photos du rapport (fleches, cercles, lignes, texte...)
-- Additif, idempotent. Aucune policy RLS touchee (lecture/ecriture service-role,
-- comme ancrage_para). NULL = photo non annotee -> le rendu retombe sur l'originale.
--   annotations_json        : donnees du dessin (re-editable), ou NULL
--   annotated_drive_file_id : id Drive de l'image annotee aplatie, ou NULL
--   annotated_drive_url     : miniature publique de l'image annotee, ou NULL
ALTER TABLE public.photos_interventions
  ADD COLUMN IF NOT EXISTS annotations_json        jsonb,
  ADD COLUMN IF NOT EXISTS annotated_drive_file_id text,
  ADD COLUMN IF NOT EXISTS annotated_drive_url     text;
