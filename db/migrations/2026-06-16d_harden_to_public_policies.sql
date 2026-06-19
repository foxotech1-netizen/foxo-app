-- ============================================================
-- 2026-06-16d — Durcissement RLS : 2 policies TO public -> TO authenticated
-- ============================================================
-- Appliquee en PROD via Supabase SQL Editor le 2026-06-16 (verifiee).
--
-- Contexte (audit coherence 2026-06-16, point 3) : 2 policies SELECT etaient
-- restees en TO public, manquees par la passe de durcissement
-- 2026-05-11d_rls_target_to_authenticated.sql (qui ne couvrait que les 5
-- policies creees par 2026-05-11c) :
--   - dossiers_sinistres :: acces_dossiers (creee en 2026-05-11b)
--   - documents :: acces_documents (table de base non versionnee ; table
--     vestige non utilisee par le code, conservee inoffensive)
-- Leur USING neutralisait deja la surface anon (mon_role/mon_organisation_id),
-- mais TO public reste une defense faible. On les passe en TO authenticated.
--
-- ALTER POLICY : ne change QUE le role cible, conserve le USING existant.
-- Idempotente (re-jouable sans effet de bord).
-- ============================================================

BEGIN;

ALTER POLICY acces_dossiers  ON public.dossiers_sinistres TO authenticated;
ALTER POLICY acces_documents ON public.documents          TO authenticated;

COMMIT;
