-- Migration : rattrapage versionnement colonnes mail metadata sur mails_analyses
-- Contexte : les colonnes sujet/expediteur/recu_le existent déjà en prod
--            (ajoutées hors VCS via le Dashboard Supabase à une date antérieure).
--            Cette migration aligne le repo sur la prod, dérive identique au cas
--            contact_telephone/contact_email résolu précédemment.
-- Lien : prépare le patch fix(mails) qui peuple ces colonnes depuis Agent 1
--        (route /api/admin/mails/analyse-deep).
-- Idempotente : ADD COLUMN IF NOT EXISTS — no-op si déjà appliquée.

ALTER TABLE public.mails_analyses
  ADD COLUMN IF NOT EXISTS sujet      TEXT,
  ADD COLUMN IF NOT EXISTS expediteur TEXT,
  ADD COLUMN IF NOT EXISTS recu_le    TIMESTAMPTZ;

NOTIFY pgrst, 'reload schema';
