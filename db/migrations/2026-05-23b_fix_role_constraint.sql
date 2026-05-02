-- Correction de db/migrations/2026-05-23_utilisateurs_techniciens.sql.
--
-- L'auteur initial supposait que `utilisateurs.role` n'existait pas et a
-- ajouté une colonne text avec une contrainte
--   check (role in ('admin','tech','partner'))
-- En réalité un enum PostgreSQL existait déjà avec les valeurs canoniques
--   (admin, syndic, courtier, technicien)
-- et les valeurs 'tech' / 'partner' n'existent pas dans ce schéma.
--
-- Selon l'environnement où la 1re migration a tourné, on est dans l'un
-- des deux cas suivants :
--
--   A. La colonne enum était déjà présente avant la migration. Comme
--      `add column if not exists role text` est no-op si la colonne
--      existe, aucune CHECK n'a été ajoutée et l'UPDATE 'tech' a échoué
--      proprement (invalid enum value). Schéma intact, simplement le
--      backfill 'technicien' n'a pas été appliqué → cette migration
--      le rejoue (idempotent).
--
--   B. Schéma sans la colonne au moment de la 1re migration. Une colonne
--      `role text` avec CHECK a été créée + backfill 'admin'/'tech'.
--      Schéma divergent → cette migration drop la CHECK, mappe les
--      valeurs incorrectes vers les valeurs canoniques, puis convertit
--      la colonne text vers l'enum existant.
--
-- Le DO block ci-dessous découvre l'état actuel et applique les
-- corrections nécessaires de manière idempotente.

do $$
declare
  current_udt text;
  enum_typ text;
begin
  select udt_name into current_udt
  from information_schema.columns
  where table_schema = 'public'
    and table_name   = 'utilisateurs'
    and column_name  = 'role';

  if current_udt is null then
    raise exception 'Colonne utilisateurs.role introuvable. Crée-la d''abord (enum role_utilisateur ou équivalent).';
  end if;

  -- Cas B : la colonne est text → drop la CHECK, mappe les valeurs
  -- incorrectes, convertit vers l'enum existant.
  if current_udt = 'text' then
    alter table public.utilisateurs
      drop constraint if exists utilisateurs_role_check;

    -- Mappe les valeurs incorrectes posées par la 1re migration vers
    -- les valeurs canoniques de l'enum.
    update public.utilisateurs set role = 'technicien' where role = 'tech';
    update public.utilisateurs set role = null         where role = 'partner';

    -- Trouve l'enum qui contient les 4 valeurs canoniques.
    select t.typname into enum_typ
    from pg_type t
    where t.typtype = 'e'
      and exists (select 1 from pg_enum e where e.enumtypid = t.oid and e.enumlabel = 'admin')
      and exists (select 1 from pg_enum e where e.enumtypid = t.oid and e.enumlabel = 'syndic')
      and exists (select 1 from pg_enum e where e.enumtypid = t.oid and e.enumlabel = 'courtier')
      and exists (select 1 from pg_enum e where e.enumtypid = t.oid and e.enumlabel = 'technicien')
    limit 1;

    if enum_typ is null then
      raise exception 'Aucun enum PostgreSQL avec les valeurs (admin, syndic, courtier, technicien) trouvé. Crée-le manuellement avant de relancer cette migration.';
    end if;

    execute format(
      'alter table public.utilisateurs alter column role type %I using role::%I',
      enum_typ, enum_typ
    );
  end if;
end $$;

-- Re-backfill avec les valeurs canoniques de l'enum (idempotent grâce
-- au filtre `role is null`).
update public.utilisateurs set role = 'admin'
  where email in ('info@foxo.be', 'foxotech1@gmail.com')
    and role is null;

update public.utilisateurs set role = 'technicien'
  where email in ('tech1@foxo.be', 'tech2@foxo.be')
    and role is null;
