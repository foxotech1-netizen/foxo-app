-- 2026-06-05_notifications_add_message_type.sql
-- Ajoute le type 'message' a la contrainte CHECK de notifications.type.
-- Idempotent : retrouve et remplace la contrainte CHECK existante.
DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'public.notifications'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%type%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('urgence','confirmation_recue','validation_requise','agent_alerte','info','message'));
