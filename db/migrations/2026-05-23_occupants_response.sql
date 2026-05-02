-- Suivi de la réponse occupant (OUI / NON / AUTRE CRÉNEAU) et trace
-- d'audit immuable.
--
-- Colonnes ajoutées sur occupants :
--   confirmed_at            : horodate la dernière réponse OUI/NON/AUTRE
--                             (sert au syndic pour savoir "depuis quand").
--   proposed_creneau_debut  : contre-proposition (réponse "AUTRE CRÉNEAU").
--   proposed_creneau_fin    : (idem).
--   response_note           : commentaire libre saisi par l'occupant.
--
-- Quand l'occupant répond "AUTRE CRÉNEAU", le code applicatif laisse
-- conf='en_attente' (la nouvelle proposition doit être validée par le
-- syndic avant de devenir le créneau officiel sur l'intervention).
--
-- Table occupant_responses_log : trace immuable de chaque clic. Sert
-- l'audit (litige sur la confirmation), le badge "nouvelle réponse"
-- côté admin, et l'analytique.

alter table public.occupants
  add column if not exists confirmed_at timestamptz,
  add column if not exists proposed_creneau_debut timestamptz,
  add column if not exists proposed_creneau_fin timestamptz,
  add column if not exists response_note text;

create table if not exists public.occupant_responses_log (
  id uuid primary key default gen_random_uuid(),
  occupant_id uuid not null
    references public.occupants(id) on delete cascade,
  intervention_id uuid not null
    references public.interventions(id) on delete cascade,
  reponse text not null
    check (reponse in ('confirme','decline','counter')),
  proposed_creneau_debut timestamptz,
  proposed_creneau_fin timestamptz,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_occupant_responses_intervention
  on public.occupant_responses_log (intervention_id, created_at desc);
create index if not exists idx_occupant_responses_occupant
  on public.occupant_responses_log (occupant_id, created_at desc);

-- RLS : l'écriture passe par les Server Actions /o/* en service_role
-- (qui bypass RLS). Côté lecture, seul l'admin doit pouvoir lister les
-- réponses depuis /admin (audit par intervention). Les anonymes (page
-- publique /o/[token]) n'ont jamais besoin de lire ce log.
alter table public.occupant_responses_log enable row level security;

drop policy if exists "admin_all_responses_log" on public.occupant_responses_log;
create policy "admin_all_responses_log"
  on public.occupant_responses_log
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
