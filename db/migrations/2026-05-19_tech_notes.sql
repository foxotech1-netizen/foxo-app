-- Notes techniciennes — bloc-notes interne, non visible côté client.
-- Le tech peut y mettre tout ce qui est utile pour lui ou ses collègues
-- (digicode oublié, accès difficile, prochaine inspection à prévoir, …).
-- Sauvegarde auto avec debounce 2s côté UI.

alter table public.interventions
  add column if not exists notes_tech text;
