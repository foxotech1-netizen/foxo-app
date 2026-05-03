-- Module devis + notes de crédit (avoirs). Réutilise la table factures
-- avec une colonne `type` pour partager l'éditeur, le PDF et les
-- server actions. Les types ont trois valeurs : facture (défaut),
-- devis, avoir.
--
-- Conventions de numéro côté app (la colonne factures.numero reste
-- unique, sans CHECK supplémentaire — la cohérence préfixe/type est
-- assurée par les server actions) :
--   facture : FV<année>-NNN  (ex. FV2026-100)  ← pattern existant conservé
--   devis   : DEV<année>-NNN (ex. DEV2026-001)
--   avoir   : NC<année>-NNN  (ex. NC2026-001)

-- ─── 1. Type de document ─────────────────────────────────────────────
alter table public.factures
  add column if not exists type text not null default 'facture'
    check (type in ('facture','devis','avoir'));

-- ─── 2. Avoir : lien vers la facture d'origine ───────────────────────
-- on delete restrict : refuse de supprimer une facture qui a un avoir
-- attaché (intégrité comptable). L'UI affiche un message clair.
alter table public.factures
  add column if not exists facture_origine_id uuid
    references public.factures(id) on delete restrict;
create index if not exists idx_factures_facture_origine
  on public.factures (facture_origine_id);

-- ─── 3. Devis : validité + conversion ────────────────────────────────
alter table public.factures
  add column if not exists validite_jours int default 30,
  add column if not exists accepted_at timestamptz,
  add column if not exists converted_to_facture_id uuid
    references public.factures(id) on delete set null;
create index if not exists idx_factures_converted_to
  on public.factures (converted_to_facture_id);

-- ─── 4. Statuts étendus ──────────────────────────────────────────────
-- Nouveaux : accepte, refuse, expire (utilisés par les devis).
-- Sous-ensembles attendus par type — validation côté app :
--   facture : brouillon, envoyee, payee, en_retard, annulee
--   avoir   : brouillon, envoyee, annulee
--   devis   : brouillon, envoyee, accepte, refuse, expire, annulee
alter table public.factures
  drop constraint if exists factures_statut_check;
alter table public.factures
  add constraint factures_statut_check
  check (statut in (
    'brouillon','envoyee','payee','en_retard','annulee',
    'accepte','refuse','expire'
  ));

-- ─── 5. Index par type pour les listings filtrés ─────────────────────
create index if not exists idx_factures_type_statut
  on public.factures (type, statut);

-- ─── 6. Cohérence de bouclage ───────────────────────────────────────
-- Un avoir doit toujours pointer vers une facture, et la facture
-- d'origine doit elle-même être de type 'facture' (pas un autre avoir
-- ni un devis). Validé applicativement à la création — une CHECK
-- simple ne peut pas faire la jointure.
