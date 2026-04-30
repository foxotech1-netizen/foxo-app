-- Emails dédiés par syndic et par ACP.
--
-- Convention : un syndic a 3 emails fonctionnels (factures, rapports,
-- communications). Une ACP peut hériter de ces emails OU les overrider.
-- Si un champ ACP est vide, on retombe sur le syndic, puis sur les
-- legacy email_facturation / email_rapport, puis email principal.
--
-- syndic_id_ref : lien explicite ACP → syndic gestionnaire (en plus
-- du lien implicite via interventions). Permet de pré-remplir les
-- factures sans intervention en cours, et de répercuter automatiquement
-- les emails du syndic.

alter table public.organisations
  add column if not exists email_factures text,
  add column if not exists email_rapports text,
  add column if not exists email_communications text;

alter table public.acps
  add column if not exists email_factures text,
  add column if not exists email_rapports text,
  add column if not exists email_communications text,
  add column if not exists syndic_id_ref uuid
    references public.organisations(id);

create index if not exists idx_acps_syndic_id_ref
  on public.acps (syndic_id_ref);

-- Mêmes colonnes sur clients (ACPs y sont stockées avec type='acp' pour
-- la facturation — table acps reste pour le côté technique/intervention).
-- Le ClientForm écrit ici directement.
alter table public.clients
  add column if not exists email_factures text,
  add column if not exists email_rapports text,
  add column if not exists email_communications text,
  add column if not exists syndic_id_ref uuid
    references public.organisations(id);

create index if not exists idx_clients_syndic_id_ref
  on public.clients (syndic_id_ref);
