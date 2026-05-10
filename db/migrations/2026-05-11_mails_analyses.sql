-- T1 du pipeline mail → intervention :
--   - Table mails_analyses : persiste l'analyse Claude par thread Gmail
--     (clé primaire = thread_id pour idempotence sur retry)
--   - Colonne interventions.drive_folder_id : lien vers le dossier Drive
--     RAPPORTS/{year}/{ref + adresse}/ créé via createInterventionFolderFromMail
--
-- Idempotent (if not exists) — peut être réappliquée sans dommage si
-- une version partielle a déjà été créée à la main côté Supabase.

create table if not exists mails_analyses (
  thread_id text primary key,
  type text,                              -- demande_intervention | relance_rapport | suivi_dossier | question_generale | accuse_reception | spam_commercial
  urgence boolean default false,
  langue text,                            -- fr | nl | en | other
  adresse_extraite text,
  numero_dossier_mentionne text,
  resume text,
  occupant_telephone text,
  occupant_email text,
  dossier_match_id uuid references interventions(id) on delete set null,
  creneau_propose_id uuid references creneaux_disponibles(id) on delete set null,
  fenetre_etendue boolean default false,
  pj_drive_ids text[] default array[]::text[],
  analyse_raw jsonb,
  errors text[] default null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists mails_analyses_dossier_match_idx
  on mails_analyses (dossier_match_id);
create index if not exists mails_analyses_type_idx
  on mails_analyses (type);

alter table interventions
  add column if not exists drive_folder_id text;

create index if not exists interventions_drive_folder_idx
  on interventions (drive_folder_id);
