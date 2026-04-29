-- Override facturation au niveau intervention.
--
-- Quand on crée une intervention syndic, l'adresse de facturation par défaut
-- est celle du syndic (organisations.adresse). Ce champ permet d'override
-- ponctuellement sans modifier la fiche syndic. Lu au moment de la
-- facturation par loadInterventionForFacture.

alter table public.interventions
  add column if not exists billing_override jsonb;
