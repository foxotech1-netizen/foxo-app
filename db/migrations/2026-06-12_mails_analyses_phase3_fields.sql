-- Mails V2 Phase 3 (fiche structurée IA) — nouveaux champs d'extraction sur
-- mails_analyses, écrits par analyse-deep :
--   - acp_nom    : nom de l'ACP / copropriété mentionnée dans le mail
--   - syndic_nom : nom du cabinet syndic (expéditeur ou mentionné)
-- Additive et idempotente. Aucune valeur écrite : les anciennes lignes
-- restent à NULL (la fiche affiche « — »).
-- NOTE : appliquée en prod via le SQL Editor Supabase le 2026-06-12, AVANT
-- le déploiement du code qui peuple ces colonnes.

ALTER TABLE mails_analyses ADD COLUMN IF NOT EXISTS acp_nom text;
ALTER TABLE mails_analyses ADD COLUMN IF NOT EXISTS syndic_nom text;

NOTIFY pgrst, 'reload schema';
