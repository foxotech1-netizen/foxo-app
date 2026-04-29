-- Étend sms_logs pour gérer aussi les rappels J-1 (cron) et tracer le canal
-- email en plus de SMS/WhatsApp.
--
-- - colonne `type` : 'confirmation' (envoi manuel par défaut), 'rappel_j1',
--                    'rapport_dispo', 'lien_occupant'
-- - channel : ajout de la valeur 'email' au CHECK existant

alter table public.sms_logs
  add column if not exists type text default 'confirmation';

create index if not exists idx_sms_logs_type_date
  on public.sms_logs (type, sent_at desc);

-- Reconstruit le CHECK pour autoriser 'email'
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'sms_logs_channel_check'
       or conname like 'sms_logs_channel%'
  ) then
    execute 'alter table public.sms_logs drop constraint if exists sms_logs_channel_check';
  end if;
end$$;

alter table public.sms_logs
  add constraint sms_logs_channel_check
  check (channel in ('sms','whatsapp','email'));
