-- ============================================================
-- Migration — Messagerie : support de l'auteur_type 'expert'
-- L'org type 'expert' existait dans TypeOrganisation mais la messagerie
-- repliait l'expert sur 'syndic' (CHECK, index, RLS, mapping API). Cette
-- migration aligne la DB pour étiqueter correctement les messages experts.
--
-- Date d'application en prod : 2026-06-04
-- Idempotente : peut être rejouée sans erreur.
-- ============================================================

BEGIN;

-- 1) CHECK auteur_type : ajouter 'expert'
ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_auteur_type_check;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_auteur_type_check
  CHECK (auteur_type IN ('admin', 'syndic', 'courtier', 'expert'));

-- 2) Index partiel "non lus côté admin" : inclure les messages d'expert
--    pour qu'ils alimentent le badge 💬 (sinon ignorés silencieusement).
DROP INDEX IF EXISTS public.idx_messages_unread_admin;

CREATE INDEX IF NOT EXISTS idx_messages_unread_admin
  ON public.messages (intervention_id)
  WHERE lu_admin = false AND auteur_type IN ('syndic', 'courtier', 'expert');

-- 3) RLS INSERT partenaire : autoriser auteur_type 'expert'
--    (mêmes garde-fous : ownership intervention + auteur_email = auth.email()).
DROP POLICY IF EXISTS "syndic_insert_messages" ON public.messages;

CREATE POLICY "syndic_insert_messages"
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    public.syndic_owns_intervention(intervention_id)
    AND auteur_type IN ('syndic', 'courtier', 'expert')
    AND lower(auteur_email) = lower(auth.email())
  );

COMMIT;
