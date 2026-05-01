-- Coordonnées géographiques pour les adresses validées via Nominatim
-- (autocomplete OpenStreetMap). Stockées en numeric pour éviter la perte
-- de précision liée au float8 quand on persiste 7 décimales.
--
-- Utilité immédiate : afficher des badges "✅ Adresse vérifiée" quand
-- lat/lng sont posés. Utilité future : carte Google Maps / Leaflet des
-- interventions, calcul de distance tech ↔ chantier, optimisation de
-- tournée.

alter table public.interventions
  add column if not exists lat numeric,
  add column if not exists lng numeric;

alter table public.acps
  add column if not exists lat numeric,
  add column if not exists lng numeric;

alter table public.organisations
  add column if not exists lat numeric,
  add column if not exists lng numeric;
