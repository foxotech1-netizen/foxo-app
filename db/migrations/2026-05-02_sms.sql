-- Système SMS / WhatsApp via Twilio.

-- Préférence de contact par occupant.
alter table public.occupants
  add column if not exists contact_preference text default 'email'
  check (contact_preference in ('email','sms','whatsapp','both'));

-- Logs des envois SMS pour audit.
create table if not exists public.sms_logs (
  id uuid primary key default gen_random_uuid(),
  intervention_id uuid references public.interventions(id),
  occupant_id uuid references public.occupants(id),
  to_phone text not null,
  channel text not null check (channel in ('sms','whatsapp')),
  message text not null,
  status text default 'sent' check (status in ('sent','failed','queued')),
  twilio_sid text,
  error text,
  cost_estimate_eur numeric default 0.05,
  sent_by text,
  sent_at timestamptz default now()
);

create index if not exists idx_sms_logs_intervention on public.sms_logs (intervention_id);
create index if not exists idx_sms_logs_sent_at on public.sms_logs (sent_at desc);

alter table public.sms_logs enable row level security;
drop policy if exists "admin_all_sms_logs" on public.sms_logs;
create policy "admin_all_sms_logs"
  on public.sms_logs
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Paramètres SMS dans la table parametres existante.
insert into public.parametres (cle, valeur) values
  ('sms_mode',                        'manuel'),
  ('sms_enabled',                     'false'),
  ('whatsapp_enabled',                'false'),
  ('sms_auto_confirmation',           'false'),
  ('sms_auto_rappel_24h',             'false'),
  ('sms_auto_rapport',                'false'),
  ('twilio_account_sid',              ''),
  ('twilio_auth_token',               ''),
  ('twilio_phone_number',             ''),
  ('twilio_whatsapp_number',          ''),
  ('sms_template_confirmation',       'Bonjour [Prénom], FoxO interviendra le [date] à [heure] pour [adresse]. Confirmez votre présence : [lien]'),
  ('sms_template_rappel_24h',         'Rappel FoxO : intervention demain [date] à [heure] — [adresse]. Contact : 0488/700.007'),
  ('sms_template_rapport',            'FoxO — Votre rapport est disponible : [lien]'),
  ('sms_template_lien_occupant',      'FoxO — Confirmez votre présence pour le [date] : [lien]')
on conflict (cle) do nothing;
