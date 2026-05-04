-- Lien direct utilisateurs → organisations pour la gestion centralisée
-- des accès partenaires (cf. /admin/utilisateurs).
--
-- ⚠️ Note d'architecture : le lien partenaire → organisation existe DÉJÀ
-- via public.delegues (table dédiée avec organisation_id, email, role,
-- actif). Cette colonne ajoute un second lien plus direct sur utilisateurs
-- pour faciliter le LEFT JOIN dans l'écran admin, au prix d'une duplication
-- potentielle. À synchroniser côté code lors de l'INSERT/UPDATE.

alter table public.utilisateurs
  add column if not exists organisation_id uuid
    references public.organisations(id) on delete set null;

create index if not exists idx_utilisateurs_organisation
  on public.utilisateurs (organisation_id)
  where organisation_id is not null;

-- ─── RPC helper : notify_pgrst_reload ─────────────────────────────────
-- Permet aux routes API d'invalider le cache de schéma PostgREST après
-- un ALTER TABLE / structure change. Pour des CRUD simples, ce n'est pas
-- strictement nécessaire — c'est un best-effort conformément au brief.
-- Les routes appellent admin.rpc('notify_pgrst_reload') et catchent
-- silencieusement si la RPC n'est pas définie.

create or replace function public.notify_pgrst_reload()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  notify pgrst, 'reload schema';
end;
$$;

revoke execute on function public.notify_pgrst_reload() from public;
grant  execute on function public.notify_pgrst_reload() to authenticated;
