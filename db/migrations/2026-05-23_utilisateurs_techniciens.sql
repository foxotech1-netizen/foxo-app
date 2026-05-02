-- Étend utilisateurs pour gérer les techniciens depuis /admin/techniciens.
--
-- Colonnes ajoutées :
--   role         : 'admin' | 'tech' | 'partner' — source d'affichage UI
--                  uniquement. L'autorisation d'accès aux portails reste
--                  pilotée par src/lib/auth/roles.ts (TECH_EMAILS /
--                  ADMIN_EMAILS hardcodées) pour ne pas casser le routage
--                  par sous-domaine. Migration progressive plus tard.
--   actif        : false = soft delete. On ne fait jamais de DELETE
--                  physique : interventions.technicien_id pointe sur ces
--                  lignes et l'historique doit survivre.
--   telephone    : numéro perso (optionnel).
--   last_seen_at : mis à jour à chaque page-load côté /tech ; calcule
--                  l'indicateur "en ligne" dans la liste admin.
--   created_at   : audit.
--
-- Backfill : les emails déjà whitelistés (ADMIN_EMAILS / TECH_EMAILS de
-- src/lib/auth/roles.ts) sont marqués avec leur rôle correspondant. Tout
-- autre utilisateur existant garde role NULL.

alter table public.utilisateurs
  add column if not exists role text
    check (role in ('admin','tech','partner')),
  add column if not exists actif boolean not null default true,
  add column if not exists telephone text,
  add column if not exists last_seen_at timestamptz,
  add column if not exists created_at timestamptz default now();

update public.utilisateurs set role = 'admin'
  where email in ('info@foxo.be', 'foxotech1@gmail.com')
    and role is null;

update public.utilisateurs set role = 'tech'
  where email in ('tech1@foxo.be', 'tech2@foxo.be')
    and role is null;

create index if not exists idx_utilisateurs_role_actif
  on public.utilisateurs (role, actif);
