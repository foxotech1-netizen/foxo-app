-- Mails V2 — Phase 2 (U2 anti-doublon PJ).
-- ⚠️ Déjà appliquée en prod via le Supabase SQL Editor le 2026-06-11 —
-- committée ici pour trace, idempotente (IF NOT EXISTS partout).
--
-- contenu_hash    : sha256 hex du contenu DÉCODÉ de la pièce jointe
--                   (jamais l'attachment_id Gmail, instable entre deux
--                   lectures d'un même mail).
-- source_mail_id  : id du message Gmail d'origine (texte, pas de FK —
--                   la table emails n'existe pas à ce jour).
-- attachments_dedup_idx : index partiel servant au skip anti-doublon
--                   (intervention_id, contenu_hash) sur les rows vivantes.

ALTER TABLE public.attachments
  ADD COLUMN IF NOT EXISTS contenu_hash text NULL;

ALTER TABLE public.attachments
  ADD COLUMN IF NOT EXISTS source_mail_id text NULL;

CREATE INDEX IF NOT EXISTS attachments_dedup_idx
  ON public.attachments (intervention_id, contenu_hash)
  WHERE intervention_id IS NOT NULL
    AND contenu_hash IS NOT NULL
    AND deleted_at IS NULL;
