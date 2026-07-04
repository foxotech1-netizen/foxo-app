-- Correctif Peppol : le message d'échec d'envoi Storecove vit dans une
-- colonne interne dédiée — plus jamais dans factures.notes (qui apparaît
-- sur le PDF). Idempotente. Déjà appliquée en prod.
ALTER TABLE public.factures ADD COLUMN IF NOT EXISTS peppol_last_error text;
