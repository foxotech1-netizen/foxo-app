-- Token unique par occupant pour le lien de confirmation envoyé via
-- email/SMS/WhatsApp. URL : https://app.foxo.be/o/<token>.
-- token_sent_at : horodatage du dernier envoi (utile pour cooldown
-- éventuel + détection "occupant notifié" dans le stepper).

alter table public.occupants
  add column if not exists confirmation_token text;

alter table public.occupants
  add column if not exists token_sent_at timestamptz;

create unique index if not exists idx_occupants_token
  on public.occupants (confirmation_token)
  where confirmation_token is not null;
