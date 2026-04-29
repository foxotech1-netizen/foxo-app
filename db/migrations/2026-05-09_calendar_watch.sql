-- Persistance de la subscription Watch API Google Calendar.
-- Ces 3 lignes sont mises à jour par les routes /calendar-watch/*
-- et lues par /cron/renew-calendar-watch + l'UI /admin/parametres.

insert into public.parametres (cle, valeur) values
  ('calendar_watch_channel_id',  ''),
  ('calendar_watch_resource_id', ''),
  ('calendar_watch_expiry',      '0')
on conflict (cle) do nothing;
