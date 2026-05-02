-- Étend utilisateurs pour gérer les techniciens depuis /admin/techniciens.
--
-- Note importante : la colonne `role` est supposée déjà présente sur
-- public.utilisateurs comme enum PostgreSQL (valeurs : admin, syndic,
-- courtier, technicien). Cette migration NE crée PAS la colonne — elle
-- ajoute uniquement les colonnes de gestion (actif, telephone, last_seen_at,
-- created_at) puis backfille `role` pour les emails déjà whitelistés
-- (ADMIN_EMAILS / TECH_EMAILS de src/lib/auth/roles.ts).
--
-- Ne pas confondre cet enum DB avec le type `Role` applicatif
-- ('admin' | 'tech' | 'partner') de src/lib/auth/roles.ts qui pilote le
-- routage par sous-domaine via la whitelist d'emails — ce sont deux
-- systèmes indépendants.
--
-- Colonnes ajoutées :
--   actif        : false = soft delete. On ne fait jamais de DELETE
--                  physique : interventions.technicien_id pointe sur ces
--                  lignes et l'historique doit survivre.
--   telephone    : numéro perso (optionnel).
--   last_seen_at : mis à jour à chaque page-load côté /tech ; calcule
--                  l'indicateur "en ligne" dans la liste admin.
--   created_at   : audit.

alter table public.utilisateurs
  add column if not exists actif boolean not null default true,
  add column if not exists telephone text,
  add column if not exists last_seen_at timestamptz,
  add column if not exists created_at timestamptz default now();

update public.utilisateurs set role = 'admin'
  where email in ('info@foxo.be', 'foxotech1@gmail.com')
    and role is null;

update public.utilisateurs set role = 'technicien'
  where email in ('tech1@foxo.be', 'tech2@foxo.be')
    and role is null;

create index if not exists idx_utilisateurs_role_actif
  on public.utilisateurs (role, actif);
