-- Ajoute la colonne canonique `classification` sur mails_analyses.
-- Idempotente, additive, n'ecrit aucune valeur. Aucun mapping en SQL.
-- La conversion des anciennes lignes (colonne heritee `type`) se fait a la
-- lecture cote TS via toCanonicalClassification() (src/lib/mail/categories.ts).

alter table public.mails_analyses
  add column if not exists classification text;

alter table public.mails_analyses
  drop constraint if exists mails_analyses_classification_check;

alter table public.mails_analyses
  add constraint mails_analyses_classification_check
  check (
    classification is null
    or classification in (
      'nouvelle_demande',
      'relance_syndic',
      'reponse_occupant',
      'demande_rapport',
      'question_facturation',
      'urgence',
      'demarchage',
      'autre'
    )
  );

create index if not exists idx_mails_analyses_classification
  on public.mails_analyses (classification);
