-- Mini-chantier « Import Odoo » — reprise de l'historique 2026 par CSV.
-- Autorise la source 'odoo_import' sur les factures d'achat : la contrainte
-- factures_achat_source_check est recréée avec la valeur supplémentaire.
-- Idempotente : rejouable sans effet de bord. Déjà appliquée en prod.
ALTER TABLE public.factures_achat DROP CONSTRAINT IF EXISTS factures_achat_source_check;
ALTER TABLE public.factures_achat ADD CONSTRAINT factures_achat_source_check
  CHECK (source in ('upload','photo','email','peppol','manuel','odoo_import'));
