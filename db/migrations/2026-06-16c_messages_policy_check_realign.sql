-- ============================================================
-- 2026-06-16c — messages : policy d'insertion + CHECK auteur_type (realignement audit)
-- ============================================================
-- Appliquee en PROD via Supabase SQL Editor le 2026-06-16 (verifiee post-application).
--
-- Contexte (audit coherence 2026-06-16) : la prod avait derive de la migration
-- 2026-06-04_extend_messages_auteur_type_expert.sql. La policy syndic_insert_messages
-- de prod etait restee en TO public avec {syndic,courtier,delegue} (sans expert),
-- alors que la 2026-06-04 declarait TO authenticated avec {syndic,courtier,expert}.
-- Le CHECK de colonne, lui, avait bien recu 'expert' (application partielle = signature
-- d'un ecrasement manuel non versionne en prod).
--
-- Decision produit (Foxo, 2026-06-16) : syndics, courtiers, EXPERTS et DELEGUES
-- peuvent poster un message. On aligne donc la prod sur :
--   - TO authenticated (au lieu de public) : durcissement, doc 02 ;
--   - auteur_type autorise par la policy = {syndic, courtier, expert, delegue} ;
--   - CHECK de colonne = {admin, syndic, courtier, expert, delegue} (ajout de 'delegue').
--
-- Idempotente. Remplace l'etat declare par la 2026-06-04 (qui n'incluait pas 'delegue').
-- ============================================================

BEGIN;

-- 1) CHECK colonne : admin/syndic/courtier/expert/delegue
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_auteur_type_check;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_auteur_type_check
  CHECK (auteur_type IN ('admin','syndic','courtier','expert','delegue'));

-- 2) Policy d'insertion : TO authenticated + experts & delegues
DROP POLICY IF EXISTS "syndic_insert_messages" ON public.messages;
CREATE POLICY "syndic_insert_messages"
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    public.syndic_owns_intervention(intervention_id)
    AND auteur_type IN ('syndic','courtier','expert','delegue')
    AND lower(auteur_email) = lower(auth.email())
  );

COMMIT;
