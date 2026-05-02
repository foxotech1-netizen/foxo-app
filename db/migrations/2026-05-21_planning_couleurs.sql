-- Couleurs personnalisables du planning :
-- - 5 paramètres pour les TYPES de créneaux (libre, réservé, bloqué,
--   Google Calendar, FoxO importé)
-- - 1 colonne `couleur` sur utilisateurs pour la couleur perso de
--   chaque technicien (s'applique sur ses créneaux réservés + son
--   badge T.N + ses events Google Calendar via colorId mappé)

insert into public.parametres (cle, valeur) values
  ('planning_couleur_libre', '#1F6B45'),
  ('planning_couleur_reserve', '#1B3A6B'),
  ('planning_couleur_bloque', '#6B7280'),
  ('planning_couleur_google', '#4338CA'),
  ('planning_couleur_foxo_importe', '#7C3AED')
on conflict (cle) do nothing;

alter table public.utilisateurs
  add column if not exists couleur text default null;

-- Couleurs par défaut pour les techs existants (si email matche).
-- ON CONFLICT n'existe pas sur UPDATE — on conditionne sur l'email.
update public.utilisateurs set couleur = '#1B3A6B'
  where email = 'tech1@foxo.be' and couleur is null;
update public.utilisateurs set couleur = '#A17244'
  where email = 'tech2@foxo.be' and couleur is null;
