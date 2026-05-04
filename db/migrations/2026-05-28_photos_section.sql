-- Photos par section du rapport — permet au tech d'attacher chaque
-- photo à une des 4 sections (Dégâts / Inspection / Conclusion /
-- Recommandations) et de réordonner manuellement à l'intérieur d'une
-- section. Une photo non attachée (section IS NULL) reste visible dans
-- le panneau global "Photos terrain" comme avant.
--
-- ⚠️ Le brief mentionnait `public.photos` mais la table réelle est
-- `public.photos_interventions` (cf. migration 2026-05-06_photos.sql).
--
-- Le CHECK accepte explicitement NULL (les anciennes lignes n'ont pas
-- de section — sans ce `IS NULL OR …` la migration échouerait sur les
-- rows existantes).

alter table public.photos_interventions
  add column if not exists section text
    check (section is null or section in (
      'degats', 'inspection', 'conclusion', 'recommandations'
    ));

alter table public.photos_interventions
  add column if not exists ordre integer default 0;

-- Index pour le rendu rapide des sections (groupBy section + ORDER BY ordre).
-- Partiel sur section non-null pour rester compact.
create index if not exists idx_photos_section_ordre
  on public.photos_interventions (intervention_id, section, ordre)
  where section is not null;
