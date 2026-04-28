-- Extension de la table occupants pour gérer plusieurs unités à inspecter.
--
-- Ajoute prenom (séparé de nom), etage (optionnel) et instructions
-- (notes spécifiques pour le tech : digicode, gardien, horaire d'accès…).
-- Le statut d'accès est déjà géré par la colonne `conf` :
--   confirme   = "Accès confirmé"
--   en_attente = "À confirmer"
--   decline    = "Pas d'accès"

alter table public.occupants add column if not exists prenom text;
alter table public.occupants add column if not exists etage text;
alter table public.occupants add column if not exists instructions text;
