-- Migration : ajout colonne occupants_extraits à mails_analyses
-- Contexte : sous-étape 1.a du chantier "Création intervention multi-occupants
--            depuis un mail". Permet à Agent 1 (route analyse-deep) de stocker
--            la liste structurée des occupants identifiés dans le thread mail,
--            pour pré-remplir la fiche d'intervention lors de la validation
--            manuelle par l'admin (ConfirmCreateForm).
-- Format : tableau JSON aligné sur la structure CronExtractedOccupant utilisée
--          par le cron check-mails.ts (qui produit déjà cette donnée mais ne
--          la stocke pas dans mails_analyses).
-- Idempotente : ADD COLUMN IF NOT EXISTS — no-op si déjà appliquée.

ALTER TABLE public.mails_analyses
  ADD COLUMN IF NOT EXISTS occupants_extraits jsonb;

NOTIFY pgrst, 'reload schema';
