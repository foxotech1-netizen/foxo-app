-- =============================================================================
-- 2026-07-04_facturation_v2_socle.sql
-- Chantier Facturation v2 — socle complet (blocs A→E, spec 06 v0.4).
-- Idempotent : sûre à rejouer.
-- =============================================================================
BEGIN;

-- ─── 0. Trigger générique updated_at ────────────────────────────────────────
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ─── 1. Numérotation continue sécurisée ─────────────────────────────────────
create table if not exists public.sequences_facturation (
  type text not null,
  annee int not null,
  prochain int not null,
  updated_at timestamptz default now(),
  primary key (type, annee)
);
alter table public.sequences_facturation enable row level security;
alter table public.sequences_facturation force row level security;
drop policy if exists "admin_read_sequences" on public.sequences_facturation;
create policy "admin_read_sequences"
  on public.sequences_facturation for select to authenticated
  using (public.is_admin());

-- Seed : reprend là où la numérotation existante s'est arrêtée (année courante).
insert into public.sequences_facturation (type, annee, prochain)
select t.type, extract(year from now())::int,
  greatest(
    coalesce((
      select max((regexp_match(f.numero, '-(\d+)$'))[1]::int) + 1
      from public.factures f
      where f.type = t.type
        and f.numero like t.prefix || extract(year from now())::int || '-%'
    ), 0),
    t.demarrage
  )
from (values
  ('facture','FV',100),
  ('devis','DEV',1),
  ('avoir','NC',1)
) as t(type, prefix, demarrage)
on conflict (type, annee) do nothing;

-- Fonction atomique : réserve et renvoie le prochain numéro (verrou de ligne).
create or replace function public.next_numero_facture(p_type text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_annee int := extract(year from now())::int;
  v_num int;
begin
  insert into public.sequences_facturation (type, annee, prochain)
  values (p_type, v_annee, 1)
  on conflict (type, annee) do nothing;

  update public.sequences_facturation
     set prochain = prochain + 1, updated_at = now()
   where type = p_type and annee = v_annee
   returning prochain - 1 into v_num;

  return v_num;
end $$;

revoke all on function public.next_numero_facture(text) from public, anon, authenticated;
grant execute on function public.next_numero_facture(text) to service_role;

-- ─── 2. Colonnes nouvelles sur factures (acomptes, Peppol, Odoo, relances) ──
alter table public.factures
  add column if not exists is_acompte boolean default false,
  add column if not exists relances_pause boolean default false,
  add column if not exists peppol_status text,
  add column if not exists peppol_document_id text,
  add column if not exists peppol_sent_at timestamptz,
  add column if not exists odoo_move_id text,
  add column if not exists odoo_pushed_at timestamptz;

create index if not exists idx_factures_relances
  on public.factures (statut, date_echeance)
  where deleted_at is null;

-- ─── 3. Sociétés (multi-tenant Bloc E — FoxO = premier client) ──────────────
create table if not exists public.societes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  nom text not null,
  tva text,
  bce text,
  peppol_id text,
  adresse text,
  iban text,
  email_capture_alias text,
  params jsonb not null default '{}',
  actif boolean not null default true
);
alter table public.societes enable row level security;
alter table public.societes force row level security;
drop policy if exists "admin_all_societes" on public.societes;
create policy "admin_all_societes"
  on public.societes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop trigger if exists trg_societes_updated_at on public.societes;
create trigger trg_societes_updated_at
  before update on public.societes
  for each row execute function public.tg_set_updated_at();

-- Seed : une seule société = celle configurée dans Paramètres (ou défaut).
insert into public.societes (nom, tva)
select
  coalesce(nullif((select valeur from public.parametres where cle = 'societe_nom'), ''), 'Fox Group SRL'),
  coalesce((select valeur from public.parametres where cle = 'societe_tva'), '')
where not exists (select 1 from public.societes);

-- ─── 4. Fournisseurs ─────────────────────────────────────────────────────────
create table if not exists public.fournisseurs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  societe_id uuid references public.societes(id),
  nom text not null,
  tva text,
  peppol_id text,
  email text,
  telephone text,
  iban text,
  adresse text,
  conditions_paiement_jours int default 30,
  categorie_comptable_defaut text,
  notes text,
  actif boolean not null default true
);
create index if not exists idx_fournisseurs_nom on public.fournisseurs (lower(nom));
create index if not exists idx_fournisseurs_tva on public.fournisseurs (tva);
alter table public.fournisseurs enable row level security;
alter table public.fournisseurs force row level security;
drop policy if exists "admin_all_fournisseurs" on public.fournisseurs;
create policy "admin_all_fournisseurs"
  on public.fournisseurs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop trigger if exists trg_fournisseurs_updated_at on public.fournisseurs;
create trigger trg_fournisseurs_updated_at
  before update on public.fournisseurs
  for each row execute function public.tg_set_updated_at();

-- ─── 5. Factures d'achat (Bloc D.1) ─────────────────────────────────────────
create table if not exists public.factures_achat (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  societe_id uuid references public.societes(id),
  fournisseur_id uuid references public.fournisseurs(id) on delete set null,
  fournisseur_nom text,                -- dénormalisé (capture avant fiche)
  numero_piece text,                   -- n° de facture du fournisseur
  date_facture date,
  date_echeance date,
  devise text not null default 'EUR',
  montant_ht numeric,
  montant_tva numeric,
  montant_ttc numeric,
  taux_tva numeric,
  lignes jsonb not null default '[]',
  categorie_comptable text,
  taux_deductibilite numeric(5,2) default 100,
  intervention_id uuid references public.interventions(id) on delete set null,
  source text not null default 'upload'
    check (source in ('upload','photo','email','peppol','manuel')),
  justificatif_drive_id text,
  justificatif_url text,
  ia_raw jsonb,
  ia_confiances jsonb,
  ia_confiance_min numeric,
  doublon_de_id uuid references public.factures_achat(id),
  statut text not null default 'a_valider'
    check (statut in ('a_valider','a_payer','payee','rejetee')),
  date_paiement date,
  moyen_paiement text,
  odoo_move_id text,
  odoo_pushed_at timestamptz,
  note_admin text
);
create index if not exists idx_factures_achat_statut on public.factures_achat (statut);
create index if not exists idx_factures_achat_fournisseur on public.factures_achat (fournisseur_id);
create index if not exists idx_factures_achat_echeance on public.factures_achat (date_echeance);
create index if not exists idx_factures_achat_intervention on public.factures_achat (intervention_id);
alter table public.factures_achat enable row level security;
alter table public.factures_achat force row level security;
drop policy if exists "admin_all_factures_achat" on public.factures_achat;
create policy "admin_all_factures_achat"
  on public.factures_achat for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop trigger if exists trg_factures_achat_updated_at on public.factures_achat;
create trigger trg_factures_achat_updated_at
  before update on public.factures_achat
  for each row execute function public.tg_set_updated_at();

-- ─── 6. Bloc E — pièces capturées ────────────────────────────────────────────
create table if not exists public.pieces_capturees (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  societe_id uuid references public.societes(id),
  canal text not null default 'upload'
    check (canal in ('upload','photo','email','peppol')),
  source_email text,
  nom_fichier text,
  mime_type text,
  drive_file_id text,
  drive_url text,
  type_detecte text
    check (type_detecte in ('ticket','facture_achat','facture_vente','autre')),
  statut text not null default 'recue'
    check (statut in ('recue','en_extraction','extraite','validee','rejetee','doublon')),
  extraction jsonb,
  confiances jsonb,
  confiance_min numeric,
  cible_table text,                    -- 'factures_achat' | 'notes_frais'
  cible_id uuid,
  doublon_de_id uuid references public.pieces_capturees(id),
  cree_par text,
  note text
);
create index if not exists idx_pieces_capturees_statut on public.pieces_capturees (statut);
create index if not exists idx_pieces_capturees_societe on public.pieces_capturees (societe_id);
alter table public.pieces_capturees enable row level security;
alter table public.pieces_capturees force row level security;
drop policy if exists "admin_all_pieces_capturees" on public.pieces_capturees;
create policy "admin_all_pieces_capturees"
  on public.pieces_capturees for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop trigger if exists trg_pieces_capturees_updated_at on public.pieces_capturees;
create trigger trg_pieces_capturees_updated_at
  before update on public.pieces_capturees
  for each row execute function public.tg_set_updated_at();

-- ─── 7. Bloc E — règles de mapping (enseigne → catégorie/compte) ────────────
create table if not exists public.regles_mapping (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  societe_id uuid references public.societes(id),
  motif text not null,                 -- ex. 'Q8' (match insensible à la casse)
  categorie text,                      -- catégorie note de frais
  categorie_comptable text,            -- compte de charge
  taux_deductibilite numeric(5,2),
  priorite int not null default 100,
  apprise boolean not null default false,  -- créée par apprentissage
  occurrences int not null default 1,
  actif boolean not null default true
);
create index if not exists idx_regles_mapping_societe on public.regles_mapping (societe_id);
alter table public.regles_mapping enable row level security;
alter table public.regles_mapping force row level security;
drop policy if exists "admin_all_regles_mapping" on public.regles_mapping;
create policy "admin_all_regles_mapping"
  on public.regles_mapping for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop trigger if exists trg_regles_mapping_updated_at on public.regles_mapping;
create trigger trg_regles_mapping_updated_at
  before update on public.regles_mapping
  for each row execute function public.tg_set_updated_at();

-- ─── 8. Barème kilométrique + colonnes km sur notes_frais ───────────────────
create table if not exists public.bareme_km (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  societe_id uuid references public.societes(id),
  date_debut date not null,
  taux_eur_km numeric not null,
  actif boolean not null default true
);
alter table public.bareme_km enable row level security;
alter table public.bareme_km force row level security;
drop policy if exists "admin_all_bareme_km" on public.bareme_km;
create policy "admin_all_bareme_km"
  on public.bareme_km for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "tech_read_bareme_km" on public.bareme_km;
create policy "tech_read_bareme_km"
  on public.bareme_km for select to authenticated
  using (actif = true);

alter table public.notes_frais
  add column if not exists societe_id uuid references public.societes(id),
  add column if not exists km_distance numeric,
  add column if not exists km_taux_applique numeric;

alter table public.factures_achat
  add column if not exists piece_capturee_id uuid references public.pieces_capturees(id);
alter table public.notes_frais
  add column if not exists piece_capturee_id uuid references public.pieces_capturees(id);

-- ─── 9. Agent d'extraction achats : élargir agent_logs.agent_name ───────────
do $$
declare r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    where c.relname = 'agent_logs'
      and pg_get_constraintdef(con.oid) like '%agent_name%'
  loop
    execute format('alter table public.agent_logs drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.agent_logs
  add constraint agent_logs_agent_name_check
  check (agent_name = any (array[
    'triage_mail'::text,
    'analyse_pj'::text,
    'rapport'::text,
    'analyse_photo'::text,
    'draft_reply'::text,
    'sms_compose'::text,
    'notes_frais_extract'::text,
    'assistant_chat'::text,
    'briefing'::text,
    'synthese_essentiel'::text,
    'extraction_cas'::text,
    'extraction_achat'::text
  ]));

-- ─── 10. Paramètres (interrupteurs — les clés API restent en variables Vercel)
insert into public.parametres (cle, valeur) values
  ('storecove_enabled',     'false'),
  ('odoo_sync_enabled',     'false'),
  ('relances_auto_enabled', 'false'),
  ('relance_delais_jours',  '7,14,30'),
  ('capture_alias_email',   '')
on conflict (cle) do nothing;

COMMIT;
NOTIFY pgrst, 'reload schema';
