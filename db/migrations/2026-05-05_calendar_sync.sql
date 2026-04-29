-- Synchronisation bidirectionnelle Google Calendar ↔ creneaux_disponibles.
-- google_event_id existe déjà depuis 2026-04-28_creneaux.sql. On ajoute
-- juste calendar_sync_token + une table pour stocker le syncToken global.

alter table public.creneaux_disponibles
  add column if not exists calendar_sync_token text;

-- Stockage du syncToken global Calendar (une seule ligne en pratique).
-- Réutilise la table parametres (clé 'gcal_sync_token').
insert into public.parametres (cle, valeur)
values ('gcal_sync_token', '')
on conflict (cle) do nothing;
