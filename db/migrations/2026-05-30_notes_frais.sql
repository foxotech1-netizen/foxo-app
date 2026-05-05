-- 2026-05-30_notes_frais.sql
--
-- Sprint 6 — Notes de frais techniciens.
-- Une note de frais représente une dépense engagée par un tech sur le
-- terrain (carburant, matériel, restauration, sous-traitance…) et qui
-- doit être remboursée ou intégrée à la facturation client.
--
-- Workflow : brouillon → soumise → approuvee → remboursee
--                                  → rejetee   (avec note_admin)
--
-- Préreq : la fonction SECURITY DEFINER public.is_admin() existe déjà.

-- ─── 1. Table ─────────────────────────────────────────────────────────
create table if not exists public.notes_frais (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  -- Auteur de la note (tech connecté). On stocke email + nom dénormalisés
  -- pour l'affichage admin sans jointure utilisateurs.
  technicien_email text not null,
  technicien_nom   text,

  -- Identification
  titre       text not null,
  categorie   text not null check (categorie in (
    'carburant', 'materiel', 'outillage', 'transport',
    'restauration', 'fournitures', 'sous_traitance', 'autre'
  )),

  -- Montants — montant_ttc est la valeur de référence pour le
  -- remboursement ; htva + taux_tva conservés pour l'export comptable.
  montant_htva numeric not null,
  taux_tva     numeric not null default 21,
  montant_ttc  numeric not null,

  fournisseur  text,
  date_depense date not null,
  description  text,

  -- Lien optionnel à une intervention (refacturable au client).
  intervention_id uuid references public.interventions(id) on delete set null,

  -- Photo du ticket (Drive) — extraction IA pour pré-remplir les champs.
  photo_url       text,
  photo_drive_id  text,
  ia_raw          jsonb,
  ia_confiance    numeric,

  -- Workflow
  statut       text not null default 'brouillon' check (statut in (
    'brouillon', 'soumise', 'approuvee', 'rejetee', 'remboursee'
  )),
  note_admin   text,
  approved_at  timestamptz,
  approved_by  text
);

-- ─── 2. Index ─────────────────────────────────────────────────────────
create index if not exists idx_notes_frais_statut       on public.notes_frais (statut);
create index if not exists idx_notes_frais_technicien   on public.notes_frais (technicien_email);
create index if not exists idx_notes_frais_date         on public.notes_frais (date_depense desc);
create index if not exists idx_notes_frais_intervention on public.notes_frais (intervention_id);

-- ─── 3. RLS ───────────────────────────────────────────────────────────
alter table public.notes_frais enable row level security;

-- Admin : accès complet.
drop policy if exists "admin_all_notes_frais" on public.notes_frais;
create policy "admin_all_notes_frais"
  on public.notes_frais for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Tech : SELECT/INSERT sur ses propres notes (matched sur l'email auth).
drop policy if exists "tech_select_own_notes_frais" on public.notes_frais;
create policy "tech_select_own_notes_frais"
  on public.notes_frais for select to authenticated
  using (lower(technicien_email) = lower(auth.email()));

drop policy if exists "tech_insert_own_notes_frais" on public.notes_frais;
create policy "tech_insert_own_notes_frais"
  on public.notes_frais for insert to authenticated
  with check (lower(technicien_email) = lower(auth.email()));

-- Tech : UPDATE limité aux statuts éditables (brouillon, soumise) — une
-- fois approuvée/rejetée/remboursée, seul l'admin peut modifier.
drop policy if exists "tech_update_own_notes_frais" on public.notes_frais;
create policy "tech_update_own_notes_frais"
  on public.notes_frais for update to authenticated
  using (
    lower(technicien_email) = lower(auth.email())
    and statut in ('brouillon', 'soumise')
  )
  with check (lower(technicien_email) = lower(auth.email()));

-- ─── 4. Trigger updated_at ────────────────────────────────────────────
-- Met à jour updated_at automatiquement à chaque UPDATE.
create or replace function public.notes_frais_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_notes_frais_updated_at on public.notes_frais;
create trigger trg_notes_frais_updated_at
  before update on public.notes_frais
  for each row execute function public.notes_frais_set_updated_at();

NOTIFY pgrst, 'reload schema';
