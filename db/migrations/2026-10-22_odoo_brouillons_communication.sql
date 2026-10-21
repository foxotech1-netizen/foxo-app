-- Chantier « brouillon Odoo depuis FoxO » — suite de l'essai du 22/10/2026.
--
-- La communication structurée (+++…+++) est dérivée par FoxO du numéro de
-- dossier et posée sur le brouillon Odoo dès sa création, pour permettre un
-- paiement sur place (QR) avant la validation. On la garde ici pour pouvoir
-- ré-afficher le QR depuis le dossier.
-- Idempotente. À appliquer en prod AVANT le code.

alter table public.odoo_brouillons
  add column if not exists communication text;

notify pgrst, 'reload schema';

-- Contrôle : la colonne doit apparaître.
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'odoo_brouillons' and column_name = 'communication';
