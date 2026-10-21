-- Chantier « Reconstruction des dossiers depuis Odoo » — étape 1 : enrichir le miroir (lecture seule).
-- Ajoute à odoo_factures ce que la reconstruction devra lire :
--   lignes          : lignes de facture [{ libelle, produit, quantite, prix_unitaire, sous_total }]
--   tiers_*         : fiche client Odoo telle que facturée (BCE au format 0000.000.000, email, téléphone, adresse).
-- Idempotente. À appliquer en prod AVANT le code.
alter table public.odoo_factures add column if not exists lignes jsonb not null default '[]'::jsonb;
alter table public.odoo_factures add column if not exists tiers_bce text;
alter table public.odoo_factures add column if not exists tiers_email text;
alter table public.odoo_factures add column if not exists tiers_telephone text;
alter table public.odoo_factures add column if not exists tiers_adresse text;
notify pgrst, 'reload schema';
