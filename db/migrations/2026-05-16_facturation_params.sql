-- Paramètres + colonnes de suivi pour la nouvelle page /admin/facturation/rappels.
--
-- Le système est full-manuel pour l'instant : on ne lance pas de cron de
-- relance automatique, mais l'admin peut activer le toggle pour qu'un
-- futur cron les déclenche selon `rappel_delai_j1` / `rappel_delai_j2`.

insert into public.parametres (cle, valeur) values
  ('rappels_auto_actifs', 'false'),
  ('rappel_delai_j1', '7'),
  ('rappel_delai_j2', '14'),
  ('rappel_template_email',
   E'Bonjour,\n\nNous vous rappelons que la facture {ref} d''un montant de {montant} € est en attente de règlement depuis {jours} jours.\n\nMerci de procéder au paiement dans les meilleurs délais.\n\nCordialement,\nFoxO')
on conflict (cle) do nothing;

alter table public.factures
  add column if not exists rappel_envoye_at timestamptz,
  add column if not exists rappel_count int default 0;

create index if not exists idx_factures_rappel_envoye
  on public.factures (rappel_envoye_at);
