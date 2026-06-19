-- ============================================================
-- 2026-06-16e — Suppression du vestige documents (table + enum document_type)
-- ============================================================
-- Appliquee en PROD via Supabase SQL Editor le 2026-06-16 (verifiee : supprimee/supprime).
--
-- Contexte (audit coherence 2026-06-16, nettoyage) : la table public.documents
-- (+ enum document_type) etait une ebauche du debut JAMAIS branchee :
--   - 0 usage dans le code (le code utilise un BUCKET storage Supabase homonyme,
--     systeme different ; metadonnees docs reelles = rapports / photos_interventions
--     / attachments / Drive) ;
--   - 0 ligne ; aucune FK entrante ; enum utilise par documents.type seulement ;
--     aucune vue dependante.
-- Suppression sans risque. DROP TABLE retire aussi les policies RLS de la table.
--
-- Idempotente.
-- ============================================================

BEGIN;
DROP TABLE IF EXISTS public.documents;
DROP TYPE IF EXISTS public.document_type;
COMMIT;
