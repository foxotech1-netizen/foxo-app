-- =============================================================================
-- 2026-05-11 — RLS core tables snapshot
-- =============================================================================
-- Versionne les policies RLS des 9 tables cœur FoxO, jusqu'ici gérées
-- uniquement via le dashboard Supabase. État capturé depuis production.
--
-- Tables couvertes (33 policies au total) :
--   - acps                 (5)
--   - clients              (1)
--   - delegues             (2)
--   - interventions        (7)
--   - occupants            (5)
--   - organisations        (5)
--   - photos_interventions (3)
--   - rapports             (3)
--   - utilisateurs         (2)
--
-- Particularités :
--   - Bascule en FORCE ROW LEVEL SECURITY : les owners postgres et les
--     SECURITY DEFINER s'exécutant comme postgres respectent désormais RLS.
--     Le rôle service_role conserve BYPASSRLS (natif Supabase) donc les routes
--     server-side utilisant SUPABASE_SERVICE_ROLE_KEY restent inchangées.
--   - 5 policies ciblent `TO public` (acces_acps, acces_interventions,
--     acces_occupants, acces_organisations, delegue_select_own_org) — capturé
--     tel quel. À auditer dans un sprint ultérieur : surface anon potentiellement
--     non voulue.
--
-- Dépendances NON versionnées (à traiter en P2 — migration séparée) :
--   Fonctions helpers utilisées par les policies, doivent préexister sur la DB :
--     mon_role(), mon_organisation_id(), is_admin(), is_partner(), is_tech(),
--     current_org_id(), current_utilisateur_id(),
--     acp_visible_to_partner(uuid, uuid), acp_visible_to_tech(uuid, uuid),
--     org_in_dossier(uuid, uuid), org_owns_intervention(uuid, uuid),
--     partner_can_access_intervention(uuid, uuid),
--     tech_owns_intervention(uuid, uuid), intervention_rapport_publie(uuid).
--   Table référencée : dossiers_sinistres (par acces_interventions).
--   Type custom : user_role (enum).
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- public.acps (5 policies)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.acps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acps FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS acces_acps ON public.acps;
CREATE POLICY acces_acps ON public.acps
  FOR SELECT
  TO public
  USING (((mon_role() = 'admin'::user_role) OR (syndic_id = mon_organisation_id())));

DROP POLICY IF EXISTS admin_all_acps ON public.acps;
CREATE POLICY admin_all_acps ON public.acps
  FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS partner_insert_acps ON public.acps;
CREATE POLICY partner_insert_acps ON public.acps
  FOR INSERT
  TO authenticated
  WITH CHECK (is_partner());

DROP POLICY IF EXISTS partner_select_acps_via_interventions ON public.acps;
CREATE POLICY partner_select_acps_via_interventions ON public.acps
  FOR SELECT
  TO authenticated
  USING (acp_visible_to_partner(id, current_org_id()));

DROP POLICY IF EXISTS tech_select_acps_via_interventions ON public.acps;
CREATE POLICY tech_select_acps_via_interventions ON public.acps
  FOR SELECT
  TO authenticated
  USING (acp_visible_to_tech(id, current_utilisateur_id()));


-- ─────────────────────────────────────────────────────────────────────────────
-- public.clients (1 policy)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_all_clients ON public.clients;
CREATE POLICY admin_all_clients ON public.clients
  FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ─────────────────────────────────────────────────────────────────────────────
-- public.delegues (2 policies)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.delegues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delegues FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_all_delegues ON public.delegues;
CREATE POLICY admin_all_delegues ON public.delegues
  FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS delegue_own_row ON public.delegues;
CREATE POLICY delegue_own_row ON public.delegues
  FOR SELECT
  TO authenticated
  USING ((lower(email) = lower(auth.email())));


-- ─────────────────────────────────────────────────────────────────────────────
-- public.interventions (7 policies)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.interventions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interventions FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS acces_interventions ON public.interventions;
CREATE POLICY acces_interventions ON public.interventions
  FOR SELECT
  TO public
  USING (
    (
      (mon_role() = 'admin'::user_role)
      OR (syndic_id = mon_organisation_id())
      OR ((mon_role() = 'technicien'::user_role) AND (technicien_id = auth.uid()))
      OR (
        (mon_role() = 'courtier'::user_role)
        AND (EXISTS (
          SELECT 1
          FROM dossiers_sinistres ds
          WHERE ((ds.intervention_id = interventions.id) AND (ds.courtier_id = mon_organisation_id()))
        ))
      )
    )
  );

DROP POLICY IF EXISTS admin_all_interventions ON public.interventions;
CREATE POLICY admin_all_interventions ON public.interventions
  FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS courtier_select_via_dossier ON public.interventions;
CREATE POLICY courtier_select_via_dossier ON public.interventions
  FOR SELECT
  TO authenticated
  USING (org_in_dossier(id, current_org_id()));

DROP POLICY IF EXISTS partner_insert_own_interventions ON public.interventions;
CREATE POLICY partner_insert_own_interventions ON public.interventions
  FOR INSERT
  TO authenticated
  WITH CHECK ((syndic_id = current_org_id()));

DROP POLICY IF EXISTS partner_select_own_interventions ON public.interventions;
CREATE POLICY partner_select_own_interventions ON public.interventions
  FOR SELECT
  TO authenticated
  USING ((syndic_id = current_org_id()));

DROP POLICY IF EXISTS tech_select_assigned_interventions ON public.interventions;
CREATE POLICY tech_select_assigned_interventions ON public.interventions
  FOR SELECT
  TO authenticated
  USING ((technicien_id = current_utilisateur_id()));

DROP POLICY IF EXISTS tech_update_assigned_interventions ON public.interventions;
CREATE POLICY tech_update_assigned_interventions ON public.interventions
  FOR UPDATE
  TO authenticated
  USING ((technicien_id = current_utilisateur_id()))
  WITH CHECK ((technicien_id = current_utilisateur_id()));


-- ─────────────────────────────────────────────────────────────────────────────
-- public.occupants (5 policies)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.occupants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.occupants FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS acces_occupants ON public.occupants;
CREATE POLICY acces_occupants ON public.occupants
  FOR SELECT
  TO public
  USING (
    (
      (mon_role() = 'admin'::user_role)
      OR (EXISTS (
        SELECT 1
        FROM interventions i
        WHERE ((i.id = occupants.intervention_id) AND (i.syndic_id = mon_organisation_id()))
      ))
    )
  );

DROP POLICY IF EXISTS admin_all_occupants ON public.occupants;
CREATE POLICY admin_all_occupants ON public.occupants
  FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS partner_insert_own_occupants ON public.occupants;
CREATE POLICY partner_insert_own_occupants ON public.occupants
  FOR INSERT
  TO authenticated
  WITH CHECK (org_owns_intervention(intervention_id, current_org_id()));

DROP POLICY IF EXISTS partner_select_own_occupants ON public.occupants;
CREATE POLICY partner_select_own_occupants ON public.occupants
  FOR SELECT
  TO authenticated
  USING (partner_can_access_intervention(intervention_id, current_org_id()));

DROP POLICY IF EXISTS tech_select_assigned_occupants ON public.occupants;
CREATE POLICY tech_select_assigned_occupants ON public.occupants
  FOR SELECT
  TO authenticated
  USING (tech_owns_intervention(intervention_id, current_utilisateur_id()));


-- ─────────────────────────────────────────────────────────────────────────────
-- public.organisations (5 policies)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisations FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS acces_organisations ON public.organisations;
CREATE POLICY acces_organisations ON public.organisations
  FOR SELECT
  TO public
  USING (((mon_role() = 'admin'::user_role) OR (id = mon_organisation_id())));

DROP POLICY IF EXISTS admin_all_organisations ON public.organisations;
CREATE POLICY admin_all_organisations ON public.organisations
  FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS delegue_select_own_org ON public.organisations;
CREATE POLICY delegue_select_own_org ON public.organisations
  FOR SELECT
  TO public
  USING (
    (id IN (
      SELECT delegues.organisation_id
      FROM delegues
      WHERE ((lower(delegues.email) = lower(auth.email())) AND (delegues.actif = true))
    ))
  );

DROP POLICY IF EXISTS partner_select_own_org ON public.organisations;
CREATE POLICY partner_select_own_org ON public.organisations
  FOR SELECT
  TO authenticated
  USING ((id = current_org_id()));

DROP POLICY IF EXISTS tech_select_organisations ON public.organisations;
CREATE POLICY tech_select_organisations ON public.organisations
  FOR SELECT
  TO authenticated
  USING (is_tech());


-- ─────────────────────────────────────────────────────────────────────────────
-- public.photos_interventions (3 policies)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.photos_interventions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photos_interventions FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_all_photos ON public.photos_interventions;
CREATE POLICY admin_all_photos ON public.photos_interventions
  FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS tech_insert_photos ON public.photos_interventions;
CREATE POLICY tech_insert_photos ON public.photos_interventions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (EXISTS (
      SELECT 1
      FROM interventions
      WHERE ((interventions.id = photos_interventions.intervention_id) AND (interventions.technicien_id = auth.uid()))
    ))
  );

DROP POLICY IF EXISTS tech_select_photos ON public.photos_interventions;
CREATE POLICY tech_select_photos ON public.photos_interventions
  FOR SELECT
  TO authenticated
  USING (
    (EXISTS (
      SELECT 1
      FROM interventions
      WHERE ((interventions.id = photos_interventions.intervention_id) AND (interventions.technicien_id = auth.uid()))
    ))
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- public.rapports (3 policies)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.rapports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rapports FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_all_rapports ON public.rapports;
CREATE POLICY admin_all_rapports ON public.rapports
  FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS partner_select_published_rapports ON public.rapports;
CREATE POLICY partner_select_published_rapports ON public.rapports
  FOR SELECT
  TO authenticated
  USING (
    (
      intervention_rapport_publie(intervention_id)
      AND partner_can_access_intervention(intervention_id, current_org_id())
    )
  );

DROP POLICY IF EXISTS tech_all_rapports ON public.rapports;
CREATE POLICY tech_all_rapports ON public.rapports
  FOR ALL
  TO authenticated
  USING (tech_owns_intervention(intervention_id, current_utilisateur_id()))
  WITH CHECK (tech_owns_intervention(intervention_id, current_utilisateur_id()));


-- ─────────────────────────────────────────────────────────────────────────────
-- public.utilisateurs (2 policies)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.utilisateurs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utilisateurs FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_all_utilisateurs ON public.utilisateurs;
CREATE POLICY admin_all_utilisateurs ON public.utilisateurs
  FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS auth_read_utilisateurs ON public.utilisateurs;
CREATE POLICY auth_read_utilisateurs ON public.utilisateurs
  FOR SELECT
  TO authenticated
  USING (true);


-- =============================================================================
-- Vérifications post-apply (à exécuter manuellement avant COMMIT en dev)
-- =============================================================================
-- 1. Compter les policies par table : doit retourner 33 lignes totales.
--    SELECT tablename, count(*) FROM pg_policies
--    WHERE schemaname='public' AND tablename IN (
--      'utilisateurs','organisations','delegues','interventions',
--      'acps','occupants','rapports','clients','photos_interventions'
--    ) GROUP BY tablename ORDER BY tablename;
--
-- 2. Confirmer ENABLE + FORCE :
--    SELECT c.relname, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
--    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname='public' AND c.relname IN (
--      'utilisateurs','organisations','delegues','interventions',
--      'acps','occupants','rapports','clients','photos_interventions'
--    ) ORDER BY c.relname;
--    → toutes les lignes doivent avoir enabled=true ET forced=true.
-- =============================================================================

COMMIT;
