-- Marquer une réponse occupant comme "vue" par l'admin, pour la retirer de la
-- carte "Réponses occupants reçues (< 48 h)" du tableau de bord sans attendre
-- l'expiration automatique à 48 h.
--
-- reponse_vue_at : horodate le moment où l'admin acquitte la réponse.
--   Une réponse est masquée du tableau de bord quand reponse_vue_at >= confirmed_at
--   (filtrage applicatif dans src/app/admin/page.tsx, /admin/interventions/page.tsx
--   et le compteur sidebar dans /admin/layout.tsx).
--   Si le MÊME occupant répond à nouveau plus tard (autre créneau, changement
--   d'avis), son confirmed_at redevient plus récent que reponse_vue_at : la
--   réponse RÉAPPARAÎT automatiquement. Aucun acquittement ne "perd" donc une
--   réponse ultérieure.
--
-- Écriture : accusé de lecture posé par la route admin
--   POST /api/admin/occupants/manage/[occupant_id]/ack-response (createAdminClient,
--   bypass RLS). Aucune policy à modifier.

alter table public.occupants
  add column if not exists reponse_vue_at timestamptz;
