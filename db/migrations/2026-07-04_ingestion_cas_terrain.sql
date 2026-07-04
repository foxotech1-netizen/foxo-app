-- ─────────────────────────────────────────────────────────────────────────
-- Chantier « Assistant terrain » — étape 4 : runner d'ingestion batch.
-- 1) Table de suivi des échecs d'ingestion (un PDF qui plante MAX_TENTATIVES
--    fois est mis de côté sans bloquer la chaîne).
-- 2) Paramètres du runner : interrupteur on/off + dossier Drive source.
-- Idempotente : rejouable sans effet de bord.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.cas_terrain_echecs (
  source_ref  text        primary key,
  erreur      text,
  tentatives  integer     not null default 1,
  updated_at  timestamptz not null default now()
);

alter table public.cas_terrain_echecs enable row level security;
alter table public.cas_terrain_echecs force row level security;

-- Lecture admin uniquement ; toutes les écritures passent par le service
-- role (createAdminClient) côté serveur — aucune policy d'écriture.
drop policy if exists "admin_read_cas_terrain_echecs" on public.cas_terrain_echecs;
create policy "admin_read_cas_terrain_echecs"
  on public.cas_terrain_echecs
  for select
  to authenticated
  using (public.is_admin());

-- Interrupteur (défaut : OFF — l'ingestion ne démarre que sur ordre explicite)
-- + dossier Drive contenant les ~2000 rapports PDF (config en base, doc 02).
insert into public.parametres (cle, valeur) values
  ('ingestion_cas_terrain', 'false'),
  ('ingestion_cas_terrain_folder_id', '1QU5E5vUJHrbT-pz1V3m-13SqV5f_JOk3')
on conflict (cle) do nothing;
