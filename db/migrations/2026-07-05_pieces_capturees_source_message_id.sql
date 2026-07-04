-- Capture par alias email (relève manuelle) : trace le message Gmail source
-- d'une pièce capturée pour dédupliquer les relèves successives.
-- Idempotente. Déjà appliquée en prod.
ALTER TABLE public.pieces_capturees ADD COLUMN IF NOT EXISTS source_message_id text;
CREATE INDEX IF NOT EXISTS idx_pieces_capturees_source_message
  ON public.pieces_capturees (source_message_id);
