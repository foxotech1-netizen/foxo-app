-- Système de liaison de dossiers + colonnes enrichies extraites par
-- l'IA. Permet de :
--   - persister explicitement action_requise / assureur / appartements
--     (au lieu de les enfouir dans description ou particulier_contact)
--   - lier deux interventions (suivi, doublon, même dossier)
--   - rattacher plusieurs mails à une même intervention (relance, suivi)
--   - flagger un délégué comme contact principal du syndic

alter table public.interventions
  add column if not exists action_requise text,
  add column if not exists assureur jsonb,
  add column if not exists appartements_concernes text[];

-- Liens entre interventions. Bidirectionnel : on insère 2 lignes
-- (A→B et B→A) pour qu'une requête sur soit A soit B remonte le lien.
create table if not exists public.intervention_liens (
  id uuid primary key default gen_random_uuid(),
  intervention_id uuid not null
    references public.interventions(id) on delete cascade,
  intervention_liee_id uuid not null
    references public.interventions(id) on delete cascade,
  type_lien text not null
    check (type_lien in ('meme_dossier','suivi','doublon','related')),
  source text default 'auto'
    check (source in ('auto','manuel')),
  note text,
  created_at timestamptz default now(),
  unique(intervention_id, intervention_liee_id)
);
create index if not exists idx_intervention_liens_iv
  on public.intervention_liens (intervention_id);

-- Mails Gmail rattachés à une intervention (mail-source ET tous les
-- échanges suivants : suivi, assurance, confirmation, etc.). Permet
-- de retrouver tout l'historique d'échanges d'un dossier.
create table if not exists public.intervention_mails (
  id uuid primary key default gen_random_uuid(),
  intervention_id uuid not null
    references public.interventions(id) on delete cascade,
  gmail_message_id text not null,
  from_email text,
  from_name text,
  subject text,
  date timestamptz,
  snippet text,
  type_mail text default 'entrant'
    check (type_mail in ('entrant','suivi','assurance','confirmation','annulation','rapport_demande')),
  created_at timestamptz default now(),
  unique(intervention_id, gmail_message_id)
);
create index if not exists idx_intervention_mails_iv
  on public.intervention_mails (intervention_id);

alter table public.delegues
  add column if not exists est_contact_principal boolean default false;
