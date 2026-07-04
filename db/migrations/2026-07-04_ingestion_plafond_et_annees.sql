-- Chantier « Assistant terrain » — étape 4 bis : garde-fous du pilote.
-- 1) Plafond budgétaire : arrêt automatique du runner à 200 fiches en base,
--    même si l'interrupteur ingestion_cas_terrain reste sur 'true'.
--    Valeur '0' ou vide = illimité.
-- 2) Périmètre d'années : seuls les rapports dont le nom de fichier commence
--    par une de ces années sont traités (CSV ; vide = toutes).
-- Ré-arbitrage humain à la fin du pilote (monter le plafond, changer les
-- années, ou s'arrêter là). Idempotente : rejouable sans effet de bord.
insert into public.parametres (cle, valeur) values
  ('ingestion_cas_terrain_max', '200'),
  ('ingestion_cas_terrain_annees', '2023,2024,2025')
on conflict (cle) do nothing;
