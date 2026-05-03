-- Suggestion d'ACP automatique sur les interventions issues du pipeline
-- mail (cf. lib/cron/check-mails.ts). Quand le score de similarité entre
-- le nom d'immeuble extrait par Claude et une ACP existante est entre
-- 60 % et 84 %, on ne lie pas automatiquement (acp_id reste null) mais
-- on stocke la suggestion pour que l'admin la confirme depuis le drawer.
--
-- Shape JSON :
--   {
--     "nom_extrait":      "Résidence du Parc",   -- texte sorti par l'IA
--     "acp_id_suggere":   "uuid",                -- candidate dans acps
--     "score":            0.78                   -- ∈ [0, 1]
--   }
--
-- À ≥ 85 % : acp_id est posé directement et acp_suggestion reste null.
-- À < 60 % : ni acp_id ni suggestion.

alter table public.interventions
  add column if not exists acp_suggestion jsonb;

-- Index partiel pour les listings admin "interventions à confirmer".
-- Reste léger : seules les interventions sans ACP mais avec suggestion
-- entrent dans l'index.
create index if not exists idx_interventions_acp_suggestion_pending
  on public.interventions (created_at desc)
  where acp_suggestion is not null and acp_id is null;
