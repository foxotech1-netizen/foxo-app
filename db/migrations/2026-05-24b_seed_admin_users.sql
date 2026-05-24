-- =============================================================================
-- 2026-05-24b_seed_admin_users.sql
-- Chantier : refacto is_admin() (étape 1.A)
-- Crée les 2 comptes admin FoxO dans la table utilisateurs.
-- Les UUID correspondent aux auth.users.id existants (FK ON DELETE CASCADE).
-- Idempotent : ON CONFLICT (id) DO NOTHING permet la ré-exécution sans erreur.
-- Dépendances : table utilisateurs (baseline prod) + auth.users (comptes créés
-- via Supabase Auth avant cette migration).
-- =============================================================================

INSERT INTO public.utilisateurs (id, role, email, prenom, nom, organisation_id, actif)
VALUES
  (
    'b6eeab14-ecba-4cd7-8002-f25f30dbc8ef',  -- auth.users.id pour info@foxo.be
    'admin',
    'info@foxo.be',
    'FoxO',
    'Admin',
    NULL,
    true
  ),
  (
    '495ab876-ae28-4952-8162-a97bc462ba39',  -- auth.users.id pour foxotech1@gmail.com
    'admin',
    'foxotech1@gmail.com',
    'FoxO Tech',
    'Admin',
    NULL,
    true
  )
ON CONFLICT (id) DO NOTHING;
