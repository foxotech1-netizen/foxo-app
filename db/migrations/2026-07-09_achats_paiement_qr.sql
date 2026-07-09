-- QR de paiement (EPC) sur les factures d'achat + contrôle anti-fraude IBAN.
-- Ajoute sur factures_achat le compte de paiement extrait du document
-- fournisseur (iban_paiement + communication) et l'horodatage de vérification
-- manuelle de l'IBAN par l'admin (iban_verifie_at) — cette dernière fait foi
-- pour éteindre le bandeau anti-fraude « fraude au virement ».
-- Idempotente. Déjà appliquée en prod.
ALTER TABLE public.factures_achat ADD COLUMN IF NOT EXISTS iban_paiement text;
ALTER TABLE public.factures_achat ADD COLUMN IF NOT EXISTS communication text;
ALTER TABLE public.factures_achat ADD COLUMN IF NOT EXISTS iban_verifie_at timestamptz;
