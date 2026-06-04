## Snapshot — PR #25 + PR #26 — 2026-06-04

**HEAD `main`** : `b8857f3` (merge PR #26)

### PR #25 — Réactivation item Assistant sidebar — mergée 2026-06-04
- Item « Assistant » réactivé dans la sidebar admin (`components/Sidebar.tsx`, à la **racine** du repo — pas `src/components/`) aux **deux** endroits : nav desktop (`NAV_PRINCIPAL`) + bottom-nav mobile (`BOTTOM_NAV`).
- TODO « Sprint 3 » périmé retiré : la page `/admin/assistant` était déjà complète et fonctionnelle (UI `AssistantChat` + `buildGlobalContext` + API `runAgent('assistant_chat')`). Le commentaire mentait sur l'état réel du code (même nature de dette que PR #23).
- Note : la bottom-nav mobile passe de 5 à 6 items — ajustement responsive éventuel à prévoir séparément.

### PR #26 — Briefing IA branché sur Claude — mergée 2026-06-04
**Objectif** : remplacer les placeholders hardcodés de `BriefingIA.tsx` (syndics fictifs, factures inventées, météo fabriquée — masqués à raison) par un briefing réel généré par Claude à partir des données Supabase live.

**Livré** :
| Fichier | Changement |
|---|---|
| `db/migrations/2026-06-04_extend_agent_name_briefing.sql` *(nouveau)* | Migration idempotente — `'briefing'` ajouté au CHECK `agent_logs.agent_name` |
| `src/lib/observability/agent-logger.ts` | Union `AgentName` étendue à `'briefing'` |
| `src/lib/observability/queries.ts` | `ALL_AGENT_NAMES` + `AGENT_KIND_BY_NAME` (`briefing: 'utility'`) |
| `src/lib/assistant/context.ts` | `buildGlobalContext(client?)` — paramètre optionnel, rétro-compatible (Assistant chat inchangé) |
| `src/lib/assistant/briefing.ts` *(nouveau)* | `getBriefing()` : `unstable_cache` 1h → `buildGlobalContext(adminClient)` → `runAgent('briefing')`. Renvoie `null` sans empoisonner le cache en cas d'échec |
| `src/app/admin/page.tsx` | `DashboardData.briefingText` peuplé via `getBriefing()` |
| `src/components/admin/BriefingIA.tsx` | Props `{ briefingText }`, bodies hardcodés supprimés, header/pills/style conservés |
| `src/app/admin/Dashboard.tsx` | Carte `BriefingIA` rendue en tête, masquée si `briefingText` null ; TODO périmé retiré |
| `src/app/admin/interventions/[id]/page.tsx` | `briefingText: null` au constructeur `DashboardData` de la vue deep-link |

**Décisions d'architecture** :
- Agent `'briefing'` dédié (pas réutilisation `assistant_chat`) → observabilité propre, coûts/tokens isolés dans `/admin/observabilite`.
- `unstable_cache` 1h (déprécié v16 mais fonctionnel) plutôt que `'use cache'` (éviterait d'activer `cacheComponents` globalement) ou `revalidate` page (figerait tout le Dashboard).
- Lecture via **client admin** car `cookies()` est interdit dans un scope `unstable_cache` ; légitime, la page `/admin` est déjà gardée par `isAdminUser`.

**Validations** : `tsc --noEmit` ✅, `next build` ✅ (Next 16.2.4 / Turbopack, 0 erreur, 0 warning), zéro nouvelle erreur lint (les 3 erreurs `page.tsx` `Date.now`/`prefer-const` préexistent à l'identique sur `main`).

**⚠️ À appliquer en prod** : jouer `2026-06-04_extend_agent_name_briefing.sql` **avant** déploiement, sinon les inserts `agent_logs` du briefing échouent sur le CHECK. Idempotente.

**Point d'attention restant** : smoke-test runtime (appel Claude réel + rendu visuel) non effectué en container — à valider sur Vercel Preview ou en local avec `ANTHROPIC_API_KEY`. Sans clé, la carte est simplement masquée (`briefingText` null).


## Snapshot 2026-06-04 — Portail : alignement expert créateur (PR #23) + data gap assuré

### HEAD git
`2f4e78e` — Merge pull request #23 fix/portal-expert-readonly → main

### Livré (PR #23, `e3f9afc`)
Audit du portail syndic/courtier/expert. Constat : 3 commentaires affirmaient « expert = lecture seule » alors que le code traite l'expert comme **créateur** de façon délibérée (branche `isExpert` dans `submitRequest` qui assouplit la réf. compagnie, formulaire `NewRequestClient` dédié, `vocab.expert.newRequestVerb` non-null). Le code est la vérité.
- Corrige les 3 commentaires périmés : `vocab.ts` (doc `newRequestVerb`), `PortalNav.tsx` (logique item « Nouveau »), `layout.tsx` (rôle expert).
- Élargit le bloc Assuré du dossier détaillé : `DossierData.isCourtier` → `isSinistre` (courtier **OU** expert) dans `interventions/[id]/page.tsx` + `DossierPortalClient`. L'expert voit désormais le bloc assureur quand les données existent.

### Architecture portail (rappel)
Portail unique auto-adaptatif (« Stratégie A ») : un seul code, vocabulaire commuté par `orgType` via `src/lib/portal/vocab.ts` (syndic / courtier / expert). Routes alias `/portal/{type}` → redirect `/portal`. Mutations via server actions `portal/actions.ts` (pas de routes `/api/portal/*`). Public : `/rdv` (RDV particuliers), `/app-hub`, `/go-hub`.

### ⚠️ Backlog ouvert — Data gap « nom de l'assuré » (expert) — NON traité (décision : documenter)
Dans la liste `/portal/interventions`, la colonne `acp_nom` affiche `—` pour les **experts**, pour deux raisons cumulées :
1. **Lecture** (`interventions/page.tsx`) : `isCourtier = type==='courtier'` strict exclut l'expert du lookup `dossiers_sinistres` ; et l'expert a `acp_id = null` → fallback `acp?.nom` null aussi.
2. **Écriture** (`submitRequest`) : `dossiers_sinistres` n'est créé **que si `ref_compagnie` est rempli**. Expert sans réf compagnie → aucun dossier → `assure_nom` **perdu en DB** (TODO déjà dans le code). `interventions.assureur` (JSONB) n'a pas de champ pour l'assuré.

**Options identifiées (pour quand on y reviendra)** :
- **A (reco)** — ajouter `assure` au JSONB `interventions.assureur` ; le poser pour courtier+expert dans `submitRequest` ; le lire en priorité dans la liste (fallback dossier→acp). Aucune migration, corrige écriture + lecture, couvre tous les experts.
- **B** — toujours créer `dossiers_sinistres` pour partenaires (retirer le guard `ref!==null`) ; risque contrainte NOT NULL sur `ref_courtier` à vérifier.
- **C** — élargir seulement `isCourtier`→`isSinistre` en lecture ; partiel (ne corrige pas la perte écriture).

Note connexe : `InterventionsPortalClient.tsx` utilise `isCourtier` strict pour l'accent/placeholder (cosmétique, non bloquant).

## Snapshot 2026-06-04 (soir) — Clôture chantier mails : dette label, validation, lot E

### HEAD git
`c2ee320` — Merge pull request #21 feat/lot-e-cron-errors → main

### Livré et mergé depuis le snapshot 2026-06-04 (Unité 4)

| PR | Merge | Sujet |
|----|-------|-------|
| #19 | `d19751a` | Retrait de la dette `FOXO_TRAITE`/`FOXO_LU` |
| #20 | `b464862` | File de validation `/admin/validation` (5 sources agrégées) |
| #21 | `c2ee320` | Surface des erreurs du cron mails (lot E) |

**PR #19 — Dette label `FOXO_TRAITE`/`FOXO_LU` (`e42486d`)**
- Décision produit : l'action manuelle « Marquer traité » devient **« Archiver »** (remove `INBOX` + `UNREAD`).
- Writers hérités supprimés : route `[id]/mark-traite` + `markMailTraite()` (`gmail.ts`) ; action batch `'traite'` (`ensureLabel('FOXO_TRAITE')`).
- Cron : query `'in:inbox is:unread'` (clauses `-label:FOXO_*` vestigiales retirées — `is:unread` suffit puisque la labellisation `FoxO/*` retire `UNREAD`).
- Doc Paramètres corrigée (mention `FoxO/*` au lieu de `FOXO_TRAITE`/`FOXO_LU`). −116/+32, 1 route supprimée.
- ⚠ Les labels `FOXO_TRAITE`/`FOXO_LU` existent encore côté Gmail sur d'anciens mails (non re-étiquetés) ; jamais re-posés. Nettoyage manuel Gmail possible si souhaité.

**PR #20 — File de validation (`106c1f6`→`9db17fb`)**
- `src/lib/admin/validation-queue.ts` : source unique des prédicats. Générique `Q` non contraint → `apply*` réutilisables en LISTE et en COUNT (`head:true`) ; contrat `FilterableQuery` minimal pour éviter le TS2589.
- `src/app/admin/validation/page.tsx` : page V1, 5 sections (mails à confirmer, rapports à valider, factures/devis brouillon, notes de frais soumises, interventions en suspens → compteur + lien Alertes).
- Entrée menu « À valider » + badge `validationCount` (Sidebar desktop + bottom-nav) ; chip dans le hub (`.catch(() => 0)`). Lecture seule, aucune migration.

**PR #21 — Lot E : erreurs cron surfacées (`09471bc`)**
- Diagnostic : le texte d'erreur du cron était produit (`result.items[].error`) et persisté dans `sms_logs` (`sent_by='cron:check-mails'`, `status='failed'`), mais l'admin ne voyait qu'un compteur « N erreur(s) » nu — `triggerCheckMailsNow` droppait `items`, et `automation_jobs.result` ne garde que les compteurs.
- Paramètres : `triggerCheckMailsNow` renvoie `errorItems` (sujet + raison) ; le feedback liste les causes et passe en rouge si `errors>0`.
- Observabilité : nouvelle section « Erreurs cron mails » lisant `sms_logs` (20 dernières, filtre période), couvre aussi les runs automatiques. Lecture seule.

### État chantier « Refonte mails »
- ✅ U1 — `categories.ts` source de vérité unique (8 valeurs canoniques + labels Gmail)
- ✅ U2 — Colonne `mails_analyses.classification` en prod
- ✅ U3 — Cron pose les labels `FoxO/*` (booléen-autorité)
- ✅ U4 — Agent deep écrit `classification` ; UI lit + filtre par classification
- ✅ Dette label `FOXO_TRAITE`/`FOXO_LU` retirée (#19)
- ✅ File de validation `/admin/validation` (#20)
- ✅ Lot E — erreurs cron observables (#21)

### Backlog mail restant
1. **Calibrage prompt cron** (seul item actif) : observer les labels `FoxO/*` sur de vrais mails ; remonter les écarts (sujet + label obtenu + attendu) pour ajuster le few-shot dans `check-mails.ts`. Désormais outillé par la section « Erreurs cron mails » d'Observabilité.
2. **Émission canonique native** (itération ultérieure) : faire émettre directement les 8 valeurs canoniques par le prompt deep (aujourd'hui : dérivation serveur `toCanonicalClassification(type)`).
3. **Lot C** (perf, non prioritaire) : synchro `historyId`/`history.list`.
4. **Dette résiduelle** : clamp silencieux à 500 dans `batchModifyMails` (`gmail.ts`).

## Snapshot 2026-06-04 — Unité 4 : classification canonique (PR #17)

### HEAD git
`10b9ad4` — Merge pull request #17 feat/unit4-classification → main

### Ce qui a été livré (Unité 4)

**Objectif** : aligner l'agent d'analyse deep et l'UI mails sur la classification canonique 8 valeurs déjà en base (`mails_analyses.classification`, migration U2).

**Approche retenue** : dérivation serveur via `toCanonicalClassification()` de `categories.ts` — le prompt Claude du deep est inchangé, zéro risque de régression cron.

| Commit | Fichier | Changement |
|--------|---------|------------|
| `0d0b86e` | `src/app/api/admin/mails/analyse-deep/route.ts` | UPSERT écrit `classification: toCanonicalClassification(analyse.type)` — seul writer de la colonne |
| `447c5d2` | `src/app/api/admin/mails/analyses/route.ts` | `classification` ajouté au SELECT + à `AnalyseRow`, propagé au client |
| `e24395b` | `src/app/admin/mails/MailAnalyseTypes.ts` + `MailAnalyseBadges.tsx` | Champ `classification: MailClassification | null` sur `MailAnalyse` ; badge piloté par le canonique avec fallback `toCanonicalClassification(classification ?? type)` pour les anciennes lignes NULL |
| `450a8a0` | `src/app/admin/mails/MailsClient.tsx` | Filtre liste par classification : dropdown 8 valeurs canoniques + option « Toutes », croise `analyses.get(thread_id)` avec fallback |

### Invariants respectés
- `categories.ts` reste l'unique endroit du mapping classification ↔ label ↔ héritage
- Le cron `check-mails.ts` est inchangé
- Le flux `confirm-and-create` est inchangé
- Aucune migration SQL (colonne `classification` déjà en prod depuis U2)
- `tsc --noEmit` ✅ — 3 erreurs lint préexistantes sur `MailsClient.tsx` antérieures à cette PR

### État chantier « Refonte mails »
- ✅ U1 — `categories.ts` source de vérité unique (8 valeurs canoniques + mapping labels Gmail)
- ✅ U2 — Colonne `mails_analyses.classification` créée en prod
- ✅ U3 — Cron pose les labels `FoxO/*` via la classification canonique
- ✅ U4 — Agent deep écrit `classification` ; UI lit + filtre par classification

### Backlog mail actif (par priorité)
1. **Calibrage prompt cron** : observer les labels `FoxO/*` sur de vrais mails, remonter les erreurs (sujet + label obtenu + label attendu) pour ajuster le few-shot dans `check-mails.ts`.
2. **Dette label** : 3 chemins posent encore `FOXO_TRAITE` ; clamp silencieux à 500 dans `batchModifyMails` ; clauses `-label:FOXO_*` vestigiales dans la query cron.
3. **Lot E** : diagnostiquer le « 1 erreur(s) » du cron (via `agent_logs` Supabase).
4. **Émission canonique native** : faire émettre directement les 8 valeurs canoniques par le prompt deep (aujourd'hui : dérivation serveur du type hérité). Itération ultérieure.
5. **File de validation** (`feat/file-validation`, non mergé) : fix NULL sur `sujet`/`expediteur`/`recu_le` (lignes mail) et `client_nom` (brouillons factures), puis PR.

# État du projet FoxO — snapshot 2026-06-02

- **Date du recap** : 2026-06-02
- **HEAD git** : `295769b` (merge PR #15 — labels FoxO/* par catégorie)
- **Branche** : `main`
- **Status** : déployé en prod par Vercel (foxo-app Ready).

## Chantier en cours — Refonte gestion des mails (Gmail = source de vérité)

**Objectif** : section Mails type Gmail/Outlook, Gmail comme source de vérité unique, triage en vraies catégories métier posées comme labels Gmail (fin du binaire FOXO_TRAITE/FOXO_LU).

**Constats d'audit (acquis)**
- Lecture déjà conforme : la liste lit Gmail en direct (`/api/admin/mails` → `listInboxMails`, no-store). Aucun miroir Supabase de l'état mail. Supabase stocke seulement `mails_analyses` (analyse IA, clé thread_id) et `intervention_mails` (lien).
- Couche d'action déjà native (`batch` : lu/non-lu via UNREAD, archive −INBOX, trash, restore, important, label, reply via threadId).
- Pas de `historyId`/`history.list` → détection par query Gmail. Synchro Gmail→plateforme assurée par re-fetch live → `historyId` = backlog perf, non requis.
- **3 taxonomies divergentes** écrivaient le même champ : cron `type_email` (7 val.), deep `MailAnalyseType` (6 val.), spec doc 03 (7 val.). Le cron N'ÉCRIT PAS `mails_analyses` (seul le deep UI le fait). Seul le booléen `est_demande_intervention` pilotait le label.

**Décisions actées**
- Fusion : classification canonique = spec doc 03 + `demarchage` (8 val.) ; label Gmail `FoxO/*` dérivé.
- Source de vérité unique = `src/lib/mail/categories.ts` ; AUCUN mapping recopié en SQL.
- Booléen `est_demande_intervention` = autorité (intervention créée → `FoxO/Intervention` toujours) ; sinon label dérivé, jamais Intervention sans intervention derrière.
- Remplacement (pas de cohabitation) de `FOXO_TRAITE`/`FOXO_LU` ; anciens mails non re-étiquetés.
- Cron n'ajoute aucune écriture DB (plafond Vercel 60 s, `MAX_MAILS_PER_RUN=1` intact).

**Livré et mergé (PR #15, merge `295769b`, déployé)**
- U1 `src/lib/mail/categories.ts` (`4858b98`) — classification canonique (8 val.), mapping → 6 labels `FoxO/*`, `toCanonicalClassification()` réconcilie cron+deep.
- U2 `db/migrations/2026-06-02_mails_analyses_classification.sql` (`1905bfd`) — colonne `classification` (idempotente, additive) — DÉJÀ APPLIQUÉE en prod.
- U3 `src/lib/cron/check-mails.ts` (`149166e`) — cron pose les labels `FoxO/*` (règle booléen-autorité).

**Mapping de réconciliation (dans categories.ts)**
- Canonique → label : nouvelle_demande/relance_syndic/urgence → Intervention ; demande_rapport → Rapport ; question_facturation → Comptable ; reponse_occupant → Occupant ; demarchage → Démarchage ; autre → Autre.
- Hérité cron : suivi_dossier→relance_syndic, confirmation_rdv/annulation→reponse_occupant, rapport_demande→demande_rapport, assurance→autre.
- Hérité deep : demande_intervention→nouvelle_demande, relance_rapport→demande_rapport, suivi_dossier→relance_syndic, question_generale/accuse_reception→autre, spam_commercial→demarchage.

**Prochaines étapes**
1. Observer les labels sur de vrais mails (Gmail info@) ; remonter erreurs (sujet + obtenu + attendu) → calibrer le prompt cron.
2. Unité 4 : aligner l'agent deep + l'UI sur le canonique. Le deep doit ÉCRIRE `mails_analyses.classification` (seul writer) ; l'UI doit LIRE/filtrer par classification (fallback `toCanonicalClassification(type)` pour anciennes lignes).

**Backlog (non prioritaire)**
- Lot C : synchro `historyId`/`history.list` (perf).
- Dette label : 3 chemins posent encore `FOXO_TRAITE` (markMailTraite/addLabelToMail/ensureLabel) ; clamp silencieux à 500 dans `batchModifyMails` ; clauses `-label:FOXO_*` de la query cron devenues vestigiales.
- Lot E : diagnostiquer « 1 erreur(s) » cron (via `agent_logs`).

---

# État du projet FoxO — snapshot fin de session 2026-05-29

- **Date du recap** : 2026-05-29 23:01
- **HEAD git** : `928d342` (merge commit PR #12)
- **Branche** : `main`
- **Status** : clean (working tree propre)
- **Production** : déployée par Vercel sur push `main`.

### Travaux récents (depuis 2026-05-25)
- **Migration email Gmail → Resend (`send.foxo.be`)** (PR #8 + #9) : l'alias Gmail `info@foxo.be` étant HS, tous les envois (auth OTP `auth/send-email`, notify-occupants, confirm-mail, invite délégué, accept-counter-proposal, notify-syndic-response, rappel facture, rapport, rdv, notifications) passent désormais par `sendEmailResend` (`src/lib/email/resend.ts`), avec support des pièces jointes (PDF facture/rapport). Commits `cefd4f9` → `68332b5`.
- **PR #10 — Observabilité IA `confidence_score`** (`5229f3b`) : `/admin/observabilite` affiche désormais une carte KPI « Confiance < 0.7 » + une colonne « Confiance » dans la table détaillée. Le dashboard observabilité lui-même était déjà implémenté.
- **PR #11 — Textes trompeurs scope Gmail** (`a981923`) : commentaire d'en-tête de `gmail.ts` + texte UI `ParametresClient.tsx` corrigés (« lecture seule / gmail.readonly » → accès complet `https://mail.google.com/`).
- **PR #12 — Faux négatif de scope test-drive** (`5e39604`) : `REQUIRED_SCOPES` de `/api/google/test-drive` comparait `gmail.readonly` en égalité stricte → signalait Gmail manquant à tort. Aligné sur `https://mail.google.com/`.
- **Cron mails** : garde-fous = **constantes en dur** dans `src/lib/cron/check-mails.ts` (`MAX_MAILS_PER_RUN=1`, `CLAUDE_TIMEOUT_MS=20s`, `DB_TIMEOUT_MS=30s`, `maxDuration=60`) — PAS des env vars Vercel. Cron piloté par **GitHub Actions** (`.github/workflows/cron-check-mails.yml`, `*/10`), pas Vercel. Régression 504 corrigée (hotfix `f16f351`), prod saine.
- **Backlog ouvert (priorité basse)** : `getAgentLogsList` exporté mais inutilisé ; DNS OVH 2 doublons orphelins zone `foxo.be` ; décision auth previews Vercel ; TODO `check-mails.ts:532` (intervention_id null en observabilité).

## 2. Cartographie src/app (arborescence, niveau 2)

```
src/app
src/app/admin
src/app/admin/alertes
src/app/admin/articles
src/app/admin/assistant
src/app/admin/clients
src/app/admin/comptabilite
src/app/admin/courtiers
src/app/admin/experts
src/app/admin/facturation
src/app/admin/google
src/app/admin/hub
src/app/admin/interventions
src/app/admin/mails
src/app/admin/metiers
src/app/admin/notes-frais
src/app/admin/observabilite
src/app/admin/parametres
src/app/admin/planning
src/app/admin/sms
src/app/admin/syndics
src/app/admin/techniciens
src/app/admin/utilisateurs
src/app/api
src/app/api/address
src/app/api/admin
src/app/api/auth
src/app/api/cron
src/app/api/facture
src/app/api/google
src/app/api/messages
src/app/api/rapport
src/app/api/tech
src/app/app-hub
src/app/auth
src/app/auth/login
src/app/auth/logout
src/app/go-hub
src/app/o
src/app/o/[token]
src/app/portal
src/app/portal/calendar
src/app/portal/courtier
src/app/portal/expert
src/app/portal/interventions
src/app/portal/nouveau
src/app/portal/syndic
src/app/rdv
src/app/tech
src/app/tech/historique
src/app/tech/interventions
src/app/tech/notes-frais
```

## 3. Modules fonctionnels (état réel)

| Module | État | Détail |
|---|---|---|
| **Observabilité IA (agent_logs)** | ✅ | Wrapper `runAgent` posé dans `src/lib/observability/`. 5 call sites instrumentés sur les 3 agents canoniques (`triage_mail` ×3, `rapport` ×1, `analyse_pj` ×1). Table `agent_logs` + `automation_jobs` en prod avec RLS hardenée. Conforme à la règle doc 02 §10. |
| **Schéma cible doc 04 — relances/notifications/attachments** | ✅ | 3 tables créées en prod par migration `2026-05-16_create_relances_notifications_attachments.sql`. RLS `FORCE`, policies admin (et par destinataire pour `notifications`). Types TypeScript miroir dans `src/lib/types/database.ts`. |
| **Hardening RLS — helpers SECURITY DEFINER** | ✅ | `mon_role()` et `mon_organisation_id()` durcis (STABLE + `SET search_path TO 'public'` + tables préfixées `public.`). Migration `2026-05-24_harden_rls_helpers.sql`. Vulnérabilité d'élévation de privilèges via search_path fermée. |

## ✅ CE QUI A ÉTÉ FAIT

### Chantier 1 — Création intervention multi-occupants depuis un mail : ✅ FAIT
Pipeline complet `mail → Agent 1 → UI validation → intervention + N occupants`.
Mails — pipeline → intervention. Multi-occupants : Agent 1 extrait dans
`mails_analyses.occupants_extraits` (jsonb), UI `ConfirmCreateForm` liste éditable,
persistance via `safeInsertOccupants` (commits `77deb63` + `31470ee` + `7ddff39`).

- **1.a** — Agent 1 + colonnes mail metadata (`sujet`/`expediteur`/`recu_le` + `occupants_extraits`) — commits `53e42d8`, `565e5a7`, `9698d36`, `05a8a3b` (rappel session précédente).
- **1.b.1** — `occupants_extraits` exposé via `/api/admin/mails/analyses` (+ types `OccupantExtrait` partagés) — commit `77deb63`.
- **1.b.2** — `ConfirmCreateForm` : liste éditable d'occupants (add/remove/edit, type + contact_preference + instructions), pré-remplie depuis `occupants_extraits` — commit `31470ee`.
- **1.c** — `/api/admin/mails/confirm-and-create` persiste les occupants via `safeInsertOccupants` (mapping `type → type_occupant`, `conf='en_attente'`, fallback rétro-compat occupant_telephone/email, best-effort) — commit `7ddff39`.
- **Note** : Validation runtime à observer dans les 24-48h via les 2 requêtes SQL préparées (cf. section "Validation runtime à observer" en fin de fichier).

### Détail technique 1.a (rappel)
- Migration `2026-05-19_mails_analyses_add_email_metadata_columns.sql` (`53e42d8`) + patch `analyse-deep` qui peuple `sujet`/`expediteur`/`recu_le` depuis `messages[0]` (`565e5a7`).
- Migration `2026-05-20a_mails_analyses_add_occupants_extraits.sql` (`9698d36`), colonne `occupants_extraits jsonb` appliquée en prod.
- Patch `analyse-deep/route.ts` (`05a8a3b`) : `ALLOWED_OCCUPANT_TYPES` (8 valeurs), `AnalyseDeepOccupant` (8 champs), helper `normalizeOccupants`, system prompt étendu (croisement CC↔occupants), `max_tokens` 1024→2048, écriture `occupants_extraits` dans l'UPSERT. Structure alignée sur `CronExtractedOccupant`.

## 🗺 PLAN GLOBAL — Chantier "Création intervention multi-occupants depuis un mail"

- **Étape 1** ✅ FAIT — Création intervention depuis mail
  - **1.a** ✅ FAIT — Extraction occupants par Agent 1
  - **1.b** ✅ FAIT — UI `ConfirmCreateForm` liste éditable d'occupants (1.b.1 expose + 1.b.2 UI)
  - **1.c** ✅ FAIT — `confirm-and-create` persiste N occupants via `safeInsertOccupants`
- **Étape 2** ⏳ PROCHAIN — Envoi des demandes de confirmation aux occupants (mail Resend + SMS/WhatsApp Twilio)
- **Étape 3** — Rapport intervention (déjà en place en grande partie, à confirmer)
- **Étape 4** — Réponse Gmail au mail initial du syndic (reply-in-thread : `In-Reply-To` + `References`, réutiliser `thread_id` + `message_id` déjà stockés)

Décisions structurantes :
- **A3 abandonné** (refonte schéma `mails_analyses` avec champs ACP/syndic/etc.) → remplacé par séquence 1.a/1.b/1.c.
- **A4 abandonné** (cross-thread auto sur chaque mail) → reporté à étape 4 si volume justifie.
- **Pas de scan transversal de boîte sur chaque analyse** : Agent 1 travaille thread-by-thread (le thread Gmail contient assez d'info dans 90 % des cas — coût LLM maîtrisé).

## 🎯 PROCHAINE SESSION — POINT D'ENTRÉE

**Chantier 2 — Envoi des demandes de confirmation aux occupants.**

- **Email** : Resend (template de confirmation avec lien personnalisé `occupants.confirmation_token`).
- **SMS / WhatsApp** : Twilio (⚠ credentials prod manquants dans `.env.local` — bloquant à lever en amont).
- Réutiliser les colonnes occupants déjà en DB :
  - `confirmation_token` + `token_sent_at` (migration `2026-05-11_occupants_token.sql`)
  - `contact_preference` (migration `2026-05-02_sms.sql`)
  - `confirmed_at` + colonnes de réponse (migration `2026-05-23_occupants_response.sql`)
- Premier prompt suggéré = audit lecture seule : routes/crons d'envoi existants (SMS compose, draft-reply), état du flux de tokens occupant, et points d'accroche pour déclencher l'envoi après `confirm-and-create`.

## 📋 BACKLOG NOTÉ AU FIL DES SESSIONS (hors séquence étape 1-4)

- **A2 (rétrogradé)** : investiguer `nb_errors: 2` préexistants sur mail `19e01b2488ac44bf` (Regimo Greenwood F4 demande_intervention). Curieux car `dossier_match_id IS NULL`. Probablement bug interne d'Agent 1.
- **Observabilité — filtres temporels** : ajouter sélecteur 1 semaine / 1 mois / 1 trimestre / 1 an sur `/admin/observabilite`. Toutes les métriques se filtrent dynamiquement.
- **Bug panorama mails "CLIENT = Hausman"** : l'UI lit `analyse_raw` directement, divergent des colonnes structurées. À revérifier maintenant que l'UI s'aligne sur `occupants_extraits` ; sinon patch cosmétique.
- **Twilio prod config** : credentials manquants `.env.local`, rappels J-1 SMS no-op (à lever pour chantier 2).
- **Backlog héritage** : dérive de schéma migrations vs prod (mon_role/mon_organisation_id sans STABLE/SET search_path), templates invoices/quotes, sidebar drag-and-drop.

## 🛠 ÉTAT DB / REPO

- **Branche** : `main`, working tree clean, aligné `origin/main`. (HEAD : voir §1 Identité — source unique.)
- **`mails_analyses`** : colonnes mail metadata + `occupants_extraits` désormais peuplées par Agent 1 à chaque analyse fraîche. Le champ `occupants_extraits` est remonté jusqu'à l'UI (route analyses + type `MailAnalyse`).
- **`occupants`** : alimentée par `confirm-and-create` (flux mail) en plus du cron `check-mails` et de `/admin/planning`. Insertion via `safeInsertOccupants` (auto-strip cascade anti-drift).

## 🧾 20 DERNIERS COMMITS

```
928d342 Merge pull request #12 from foxotech1-netizen/fix/test-drive-scope-gmail
5e39604 fix: aligne le scope Gmail attendu du test-drive sur mail.google.com (corrige faux négatif)
87042e4 Merge pull request #11 from foxotech1-netizen/fix/scope-gmail-textes-trompeurs
a981923 fix: corrige le texte trompeur sur le scope Gmail (accès complet, pas readonly)
59b9eb0 Merge pull request #10 from foxotech1-netizen/claude/gallant-brahmagupta-AknOA
5229f3b feat(observabilite): affiche confidence_score (KPI < 0.7 + colonne table agents)
0d2095f Merge pull request #9 from foxotech1-netizen/claude/sweet-bell-ku3Ey
68332b5 chore(email): cleanup post-migration Resend (code mort google_not_connected + labels)
39a4719 refactor(email): notifications passe par sendEmailResend (sendOne local délègue au helper)
803c0f9 refactor(email): rapport passe par sendEmailResend (utilise attachments du helper)
2980225 refactor(email): rdv passe par sendEmailResend (supprime sendOne local)
534caf6 refactor(email): auth/send-email passe par sendEmailResend (cleanup BYPASS + commentaire obsolète)
f500aed feat(email): sendEmailResend supporte attachments (PDF facture, rapport, …)
627e536 Merge pull request #8 from foxotech1-netizen/claude/env-example-resend-send-subdomain
92c51fc fix(email): migre notify-syndic-response vers Resend send.foxo.be (remplace Gmail info@foxo.be HS)
b011a33 fix(email): migre notify-occupants vers Resend send.foxo.be (remplace Gmail info@foxo.be HS)
5931489 fix(email): migre confirm-mail vers Resend send.foxo.be (remplace Gmail info@foxo.be HS)
b8ef1da fix(email): migre accept-counter-proposal vers Resend send.foxo.be (remplace Gmail info@foxo.be HS)
3484ffe fix(email): migre invite délégué vers Resend send.foxo.be (remplace Gmail info@foxo.be HS)
cefd4f9 fix(facturation): rappel facture via Resend send.foxo.be (remplace Gmail info@foxo.be HS)
```

## 🔁 RAPPEL PROTOCOLE

- Pre-push hook Husky `tsc --noEmit` actif (depuis commit `5c310d7`).
- Commits split par couche (db / mails / docs / etc.), conventional commits format.
- `ETAT_PROJET.md` (ce fichier) = source de vérité chargée au début de chaque session.

## 🔎 VALIDATION RUNTIME À OBSERVER (chantier 1, 24-48h)

À exécuter dans Supabase SQL Editor.

```sql
-- Interventions issues du flux mail créées dans les dernières 24h,
-- avec le nombre d'occupants rattachés en DB.
SELECT
  i.id,
  i.ref,
  i.adresse,
  i.created_at,
  COUNT(o.id) AS occupants_count
FROM public.interventions i
LEFT JOIN public.occupants o ON o.intervention_id = i.id
WHERE i.source = 'mail'
  AND i.created_at > NOW() - INTERVAL '24 hours'
GROUP BY i.id, i.ref, i.adresse, i.created_at
ORDER BY i.created_at DESC;
```

```sql
-- Détail des occupants insérés (vérifie mapping type_occupant / contact_preference / conf).
SELECT
  i.ref,
  o.appartement, o.etage, o.prenom, o.nom,
  o.email, o.telephone,
  o.type_occupant, o.contact_preference, o.conf,
  o.created_at
FROM public.occupants o
JOIN public.interventions i ON i.id = o.intervention_id
WHERE i.source = 'mail'
  AND i.created_at > NOW() - INTERVAL '24 hours'
ORDER BY i.ref, o.created_at;
```

## 6. Marqueurs TODO/FIXME/HACK (live)

```
src/app/admin/Dashboard.tsx:14:// TODO Sprint Brouillons IA + Briefing : réactiver BriefingIA
src/lib/ponto.ts:35:// TODO : OAuth2 client_credentials → token. Stocker en cache mémoire (TTL).
src/lib/ponto.ts:42:// TODO : récupère les transactions sur la fenêtre [from, to] et les matche
src/lib/cron/check-mails.ts:532:  // TODO observabilité (chantier 1) : intervention_id reste null dans
```

## 7. Routes API (`route.ts`)

```
src/app/api/address/autocomplete/route.ts
src/app/api/admin/acps/[id]/route.ts
src/app/api/admin/acps/route.ts
src/app/api/admin/assistant/chat/route.ts
src/app/api/admin/attachments/analyse/route.ts
src/app/api/admin/calendar/events/route.ts
src/app/api/admin/clients/[id]/route.ts
src/app/api/admin/facturation/send-rappel/[id]/route.ts
src/app/api/admin/facture/[id]/route.ts
src/app/api/admin/interventions/[id]/accept-counter-proposal/route.ts
src/app/api/admin/interventions/[id]/apply-reanalysis/route.ts
src/app/api/admin/interventions/[id]/assign/route.ts
src/app/api/admin/interventions/[id]/color/route.ts
src/app/api/admin/interventions/[id]/confirm-mail/route.ts
src/app/api/admin/interventions/[id]/delete/route.ts
src/app/api/admin/interventions/[id]/historique/route.ts
src/app/api/admin/interventions/[id]/liens/route.ts
src/app/api/admin/interventions/[id]/lier/route.ts
src/app/api/admin/interventions/[id]/notify-occupants/route.ts
src/app/api/admin/interventions/[id]/reanalyze/route.ts
src/app/api/admin/interventions/[id]/recipients/route.ts
src/app/api/admin/interventions/[id]/route.ts
src/app/api/admin/interventions/[id]/schedule/route.ts
src/app/api/admin/interventions/search/route.ts
src/app/api/admin/mails/[id]/analyze/route.ts
src/app/api/admin/mails/[id]/labels/route.ts
src/app/api/admin/mails/[id]/mark-traite/route.ts
src/app/api/admin/mails/[id]/reply/route.ts
src/app/api/admin/mails/[id]/route.ts
src/app/api/admin/mails/analyse-deep/route.ts
src/app/api/admin/mails/analyses/route.ts
src/app/api/admin/mails/batch/route.ts
src/app/api/admin/mails/confirm-and-create/route.ts
src/app/api/admin/mails/draft-reply/route.ts
src/app/api/admin/mails/labels/route.ts
src/app/api/admin/mails/route.ts
src/app/api/admin/mails/unread-count/route.ts
src/app/api/admin/notes-frais/extract/route.ts
src/app/api/admin/occupants/[id]/route.ts
src/app/api/admin/occupants/manage/[occupant_id]/route.ts
src/app/api/admin/organisations/[id]/route.ts
src/app/api/admin/organisations/route.ts
src/app/api/admin/parametres/planning-couleurs/route.ts
src/app/api/admin/planning/dispos/bulk/route.ts
src/app/api/admin/planning/dispos/resync/route.ts
src/app/api/admin/planning/dispos/route.ts
src/app/api/admin/sms/compose/route.ts
src/app/api/admin/sms/send/route.ts
src/app/api/admin/societe/upload-logo/route.ts
src/app/api/admin/syndics/[org_id]/acps/route.ts
src/app/api/admin/syndics/[org_id]/delegues/[id]/invite/route.ts
src/app/api/admin/syndics/[org_id]/delegues/[id]/route.ts
src/app/api/admin/syndics/[org_id]/delegues/route.ts
src/app/api/admin/syndics/[org_id]/route.ts
src/app/api/admin/tech-summary/[id]/route.ts
src/app/api/admin/techniciens/[id]/interventions/route.ts
src/app/api/admin/utilisateurs/[id]/route.ts
src/app/api/admin/utilisateurs/route.ts
src/app/api/auth/send-email/route.ts
src/app/api/cron/check-mails/preview/route.ts
src/app/api/cron/check-mails/route.ts
src/app/api/cron/rappel-j1/preview/route.ts
src/app/api/cron/rappel-j1/route.ts
src/app/api/cron/renew-calendar-watch/route.ts
src/app/api/facture/[id]/route.ts
src/app/api/google/auth/route.ts
src/app/api/google/calendar-events/route.ts
src/app/api/google/calendar-import/route.ts
src/app/api/google/calendar-sync/route.ts
src/app/api/google/calendar-watch/subscribe/route.ts
src/app/api/google/calendar-watch/unsubscribe/route.ts
src/app/api/google/calendar-webhook/route.ts
src/app/api/google/callback/route.ts
src/app/api/google/test-drive/route.ts
src/app/api/messages/[id]/lu/route.ts
src/app/api/messages/route.ts
src/app/api/rapport/[id]/route.ts
src/app/api/tech/articles/route.ts
src/app/api/tech/facture/[id]/route.ts
src/app/api/tech/facture/route.ts
src/app/api/tech/interventions/[id]/notes/route.ts
src/app/api/tech/notes-frais/[id]/submit/route.ts
src/app/api/tech/notes-frais/route.ts
src/app/api/tech/notes-frais/upload/route.ts
src/app/api/tech/observations/[id]/photos/route.ts
src/app/api/tech/observations/[id]/route.ts
src/app/api/tech/observations/route.ts
src/app/api/tech/photos/[id]/route.ts
src/app/api/tech/photos/route.ts
src/app/api/tech/rapport-docx/route.ts
src/app/api/tech/upload-photo/route.ts
```

## 8. Journal des chantiers (depuis 2026-05-11)

### 2026-05-11 → 2026-05-13 — Hardening RLS Supabase
- Audit RLS complet sur 9 tables coeur, 5 policies upgradées de
  `TO public` → `TO authenticated` (migration `2026-05-11c`).
- Création de 14 helpers SECURITY DEFINER + enum `user_role` + table
  `dossiers_sinistres` (migration `2026-05-11d`).
- Dette identifiée à résoudre plus tard : naming alphabétique inverse
  (`c` avant `d`) vs ordre de dépendance d'exécution.

### 2026-05-13 → 2026-05-17 — Chantier #1 AI Observability (clos le 2026-05-24)
- Migration `2026-05-13_create_agent_logs_automation_jobs.sql`
  appliquée : tables `agent_logs` + `automation_jobs` avec RLS
  `FORCE` et politiques `is_admin()`.
- Fichiers TS créés sous `src/lib/observability/` (pricing, agent-logger,
  automation-logger, index) sur le pattern `createAdminClient`.
- 8 sites d'appel Anthropic API identifiés : 3 sur Agent 1 (Triage Mail)
  restent à instrumenter pour satisfaire doc 02 §10.

### 2026-05-17 → 2026-05-20 — Pipeline mails multi-occupants
- Colonne `mails_analyses.occupants_extraits` (jsonb) ajoutée.
- `analyse-deep` extrait désormais la liste `occupants[]` typée.
- UI admin : `ConfirmCreateForm` éditable, `analyses/route` expose
  `occupants_extraits`, `confirm-and-create` insère via
  `safeInsertOccupants` (auto-strip cascade ×6 sur colonnes manquantes).
- Colonnes prod confirmées : 20/20 sur `interventions`, 11/11 sur
  `occupants` (audit du 2026-05-24).

### 2026-05-20 — Premier fix cron check-mails (commit `7cee927`)
- 504 FUNCTION_INVOCATION_TIMEOUT sur le cron Vercel.
- Fix initial : `MAX_MAILS_PER_RUN` 5→2, `CLAUDE_TIMEOUT_MS` 30s→20s,
  schedule cron `*/30` → `*/10`.
- Limite identifiée : le fix ne bornait que Claude + Gmail, pas la
  phase DB (`createInterventionFromMail`).

### 2026-05-24 — Hotfix 504 récurrent (commit `f16f351`)
**Contexte** : récurrence du 504 sur run #313 malgré le fix de mai. Run
de validation post-fix : #338 verte en 17s (vs 1m02s timeout précédent).

**Diagnostic** :
- Cause racine : `createInterventionFromMail` (src/lib/cron/check-mails.ts
  ligne ~2004) n'avait aucun `withTimeout` contrairement aux 3 autres
  étapes du pipeline (`getMailDetail`, `analyzeMailWithClaude`,
  `addLabelToMail`).
- Amplificateur : cascades de retry sans backoff sur les inserts
  `interventions` (×5) et `occupants` (×6), déclenchables par
  PGRST204 (cache PostgREST obsolète après `ALTER TABLE`, fréquent
  en prod transitoirement post-migration).
- Schéma prod audité : 20/20 colonnes `interventions` et 11/11 colonnes
  `occupants` confirmées — pas de colonne manquante.

**Patch** :
- `MAX_MAILS_PER_RUN` 2 → 1 (marge défensive pendant le drain)
- Nouvelle constante `DB_TIMEOUT_MS = 30_000`
- `createInterventionFromMail` enveloppée dans `withTimeout` avec
  catch local différencié (timeout normalisé vs exception DB
  inattendue).
- Sur timeout : log + errors++ + items.push + logMailEntry + continue
  sans label Gmail → le mail reste `is:unread` et est repris au run
  suivant.

**Budget post-patch (pire cas par mail)** :
- getMailDetail 10s + Claude 20s + DB 30s + Label 10s = 70s théorique
- En pratique Gmail/Label finissent en ~1s → plafond réel ~52s,
  largement sous les 60s Vercel Hobby.

**TODOs ouverts post-hotfix** :
1. Remonter `MAX_MAILS_PER_RUN` à 2 après 24-48h de stabilité auto.
2. Décision business : upgrade Vercel Hobby → Pro ($20/mois) qui
   ouvrirait `maxDuration = 300s` et permettrait de revert aux
   paramètres pré-mai (MAX=5, CLAUDE=30s, cron */30).
3. Instrumenter `safeInsertOccupants` avec un compteur de strip
   pour mesurer la fréquence réelle des cascades PGRST204 en prod.

## Chantiers clos

### Chantier #1 — AI Observability — clos le 2026-05-24
- Tables `agent_logs` et `automation_jobs` créées en prod (migration `2026-05-13_create_agent_logs_automation_jobs.sql`, idempotente), RLS `FORCE ROW LEVEL SECURITY`, policy `admin_select` `TO authenticated`.
- Wrapper `runAgent<TOutput>` dans `src/lib/observability/agent-logger.ts` — signature : `(input: AgentRunInput<TOutput>) => Promise<AgentRunResult<TOutput>>`. Dégradation gracieuse si insert log échoue (logId = '', pas de throw).
- Pricing helper : `src/lib/observability/pricing.ts` (`estimateCostEurCents`, `MODEL_PRICING`).
- Miroir TypeScript dans `src/lib/types/database.ts` (interfaces `AgentLog`, `AutomationJob`, types `AgentName`, `AgentLogStatus`, `AutomationJobStatus`).
- 5 call sites Agent canoniques instrumentés :
  - `src/lib/cron/check-mails.ts:537` (triage_mail, cron)
  - `src/app/api/admin/mails/[id]/analyze/route.ts:111` (triage_mail, manuel admin)
  - `src/app/api/admin/mails/analyse-deep/route.ts:397` (triage_mail, deep analysis)
  - `src/lib/agents/analyse-pj/analyze-one.ts:86` (analyse_pj)
  - `src/app/tech/interventions/[id]/generate-action.ts:226` (rapport)
- Aucun cast, aucun `as any`, aucun `@ts-ignore` autour des call sites.
- Note historique : 2 conventions de prompt coexistaient initialement pour `triage_mail`. Harmonisation traitée et close dans le Chantier #5 (2026-05-24).

### Chantier #2 — Tables relances/notifications/attachments — clos le 2026-05-24
- Migration `db/migrations/2026-05-16_create_relances_notifications_attachments.sql` appliquée en production le 2026-05-24 (vérifié via Supabase SQL Editor).
- 3 tables créées avec RLS `ENABLE` + `FORCE ROW LEVEL SECURITY`, policies admin via `is_admin()`, policies par destinataire pour `notifications`, triggers `foxo_set_updated_at()`, CHECK constraints multi-colonnes, index partiels.
- Compte effectif en prod : attachments (16 col, 1 policy, 5 index), notifications (10 col, 4 policies, 4 index), relances (13 col, 1 policy, 5 index).
- Types TypeScript miroir ajoutés dans `src/lib/types/database.ts` : `Relance`, `Notification`, `Attachment` + unions `RelanceType`, `RelanceCanal`, `RelanceEfficacite`, `NotificationType`, `AttachmentTypeDetecte`.
- Aucun code applicatif ne consomme encore ces tables — chantiers futurs : module rappels (relances), notifications admin (notifications), pipeline PJ post-mail (attachments).

### Chantier #3 — Hardening RLS helpers — clos le 2026-05-24
- Migration `db/migrations/2026-05-24_harden_rls_helpers.sql` appliquée en production le 2026-05-24 (vérifié via Supabase SQL Editor).
- 2 fonctions durcies : `mon_role()` et `mon_organisation_id()` désormais `STABLE SECURITY DEFINER SET search_path TO 'public'` avec table `public.utilisateurs` explicitement préfixée.
- `is_admin()` était déjà conforme (vérifié à l'audit) — non touchée par ce chantier.
- Aucune policy RLS modifiée, signatures et types de retour inchangés. 0 impact code TypeScript (aucun appel `.rpc()` sur ces helpers).
- Pattern de référence appliqué : `current_utilisateur_id()` (migration `2026-05-11b`).
- Sujets latents identifiés par l'audit mais NON traités ici (reportés à des chantiers dédiés) :
  - Drift entre l'enum `user_role` et la colonne `utilisateurs.role` (initialement soupçonné). **Infirmé le 2026-05-24** : la colonne est en réalité typée enum `user_role` en prod (migration de bascule `2026-05-23b_fix_role_constraint.sql`, idempotente, déjà appliquée). Voir Chantier #4 pour la cartographie complète des 3 vocabulaires de rôle.
  - Liste d'emails admin hardcodée dans `is_admin()` (`info@foxo.be`, `foxotech1@gmail.com`).

### Chantier #4 — Drift user_role / utilisateurs.role : exploration et clôture — clos le 2026-05-24
- Drift soupçonné par l'audit du Chantier #3. Vérifications Supabase + audit code → **drift inexistant**.
- État réel constaté en prod (vérifié via 4 requêtes Supabase) :
  - `utilisateurs.role` est typée `USER-DEFINED user_role` (enum), pas `text`.
  - Aucun CHECK constraint sur la colonne.
  - Valeurs présentes : `technicien` (2), `syndic` (1). Toutes conformes à l'enum.
  - Cast `user_role` réussi sans erreur.
- Migration de bascule présente et versionnée : `db/migrations/2026-05-23b_fix_role_constraint.sql` (idempotente, cas A = déjà enum / cas B = text à convertir, avec normalisation `tech` → `technicien` et `partner` → null).
- **Cartographie des 3 vocabulaires de rôle** (séparés par conception, à ne jamais croiser) :
  - Enum Postgres `user_role` (12 valeurs : `admin`, `syndic`, `courtier`, `technicien`, `assurance`, `expert`, `entrepreneur`, `plombier`, `electricien`, `toiturier`, `chauffagiste`, `autre_metier`) — **persistance** dans `utilisateurs.role`.
  - Type TS `RoleUtilisateur` (4 valeurs : `admin`, `syndic`, `courtier`, `technicien`) — **miroir TS volontairement restreint au sous-ensemble humain** (les autres valeurs sont métier et n'ont pas de comptes utilisateurs aujourd'hui).
  - Type TS `Role` dans `src/lib/auth/roles.ts` (3 valeurs : `admin`, `tech`, `partner`) — **abstraction de routage** dérivée de l'email, sans lien avec la DB. Détermine `pathForRole` et `SUBDOMAIN_FOR_ROLE`.
- Code TS audité : aucune comparaison ne confronte `utilisateurs.role` à `'tech'` ou `'partner'`. Tous les `role === 'tech'` portent sur la sortie de `roleForEmail()`.
- Action préventive : commentaire-pivot ajouté en tête de `src/lib/auth/roles.ts` pour expliciter la séparation.

### Chantier #5 — Harmonisation conventions prompt triage_mail — clos le 2026-05-24
- État entrant : 2 conventions de prompt coexistaient sur les 3 call sites `triage_mail` (audit révélé : divergences sur `system` séparé vs embarqué, `temperature` absente sur 2/3 sites, `max_tokens` hétérogène 4096/2048/1024). Note résiduelle laissée ouverte à la clôture du Chantier #1.
- Convention cible adoptée : `model = claude-sonnet-4-6`, `max_tokens = 4096`, `temperature = 0`, `system:` séparé (consignes statiques + schéma JSON), `user:` réduit aux données runtime (mail brut + métadonnées).
- 3 commits, un par call site :
  - `5f96b9a` — CS3 `src/app/api/admin/mails/[id]/analyze/route.ts` : `max_tokens 1024 → 4096`, split system/user, `temperature: 0`.
  - `ef4f81b` — CS1 `src/lib/cron/check-mails.ts` (`analyzeMailWithClaude`) : split system/user (persona + contacts récurrents + règles + few-shot + schéma JSON → `system`), `temperature: 0`, adaptation du bloc de logging verbose (`system_chars`/`user_chars` au lieu de `prompt_chars`).
  - `c25f05a` — CS2 `src/app/api/admin/mails/analyse-deep/route.ts` : `max_tokens 2048 → 4096` (CS2 était déjà conforme sur `system` séparé et `temperature: 0`).
- Aucun changement de schéma de sortie JSON, aucun changement de parser (`tryParseJson` / `extractJson` inchangés), aucun changement de signature `runAgent`, aucun changement d'`inputSummary` pour les logs `agent_logs`.
- Bénéfices : extraction déterministe (rejouable, testable), prompt caching côté Anthropic activé via `system` séparé, plafond `max_tokens` uniforme à 4096 (marge confortable, JSON ne sera plus tronqué).
- Protocole appliqué : audit lecture seule avant chaque patch (1 audit global + 2 micro-audits CS1/CS2), patch chirurgical par `str_replace`, typecheck + diff + validation visuelle avant chaque commit, 1 commit par call site.

### Chantier #6 — Refacto `is_admin()` : retrait de la whitelist ADMIN_EMAILS — clos le 2026-05-25

- **État entrant** : autorisation admin dérivée d'une whitelist d'emails en dur (`ADMIN_EMAILS`, `SUBDOMAIN_FOR_ROLE`) répandue sur ~80 call-sites côté TS et dans la fonction SQL `public.is_admin()`. Source de vérité dupliquée et non testable.

- **Cible** : table `utilisateurs.role` comme unique source de vérité pour toute décision d'autorisation admin, côté SQL et côté TS.

- **Ce qui a été fait** :
  - Migration SQL `db/migrations/2026-05-25_switch_is_admin_to_utilisateurs_role.sql` — bascule `public.is_admin()` sur `utilisateurs.role = 'admin'` (commit `df8898b`).
  - Nouveau helper `src/lib/auth/server.ts` — `isAdminUser()` + `roleForUser()` + `roleForUserId(userId)` middleware-compatible (commits `9e1cde0`, `a7fe5e9`, `315a019`).
  - `assertAdmin()` consomme désormais `isAdminUser()` (commit `e0d4ba2`).
  - 10 fonctions locales `assertAdmin` migrées par effet de levier (~70 call-sites, commit `c2c9d32`).
  - 64 checks inline `roleForEmail !== 'admin'` migrés vers `isAdminUser()` (commit `ecc62f5`).
  - 3 gates admin atypiques manqués par le grep mécanique, attrapés par audit C.3 (commit `f203001`).
  - 5 consommateurs routage migrés vers `roleForUser` / `roleForUserId` : proxy, page racine, login actions/page, accès rapport (commit `f1fe5e8`).
  - Login OTP gate ne consulte plus `ADMIN_EMAILS` (commit `f56d688`).
  - Retrait final `ADMIN_EMAILS` + `SUBDOMAIN_FOR_ROLE` + migration `tech||admin` sur 15 fichiers (commit `57a22a9`).
  - Merge dans `main` via PR #3 le 2026-05-25 (merge commit `3312cac`).

- **Défense en profondeur post-merge** : plus aucune whitelist d'emails admin en dur dans le codebase. Tous les chemins admin lisent `utilisateurs.role` :
  - SQL `public.is_admin()` → `utilisateurs.role = 'admin'`
  - TS `isAdminUser()` → `utilisateurs.role = 'admin'`
  - TS `roleForUser()` / `roleForUserId()` → `utilisateurs.role` mappé en `Role`
  - Login OTP gate → `utilisateurs WHERE email AND actif = true`

- **Validation** : `tsc --noEmit` vert (hook pre-push), `next build` vert (validation bundle middleware post-3.4a-bis), deux tests runtime sur Preview Vercel (post-3.4b et post-3.5, login admin → `/admin` accessible).

- **Note opérationnelle** : le break-glass admin par variable d'env est mort. Recovery en cas de désactivation accidentelle de tous les admins dans `utilisateurs` = re-exécuter `db/migrations/2026-05-24b_seed_admin_users.sql` depuis le SQL Editor Supabase (idempotent).

- **Hors-scope laissés explicitement de côté** : `roleForEmail` dérive encore `'tech'` via `TECH_EMAILS` (chantier équivalent à faire pour les techs si on veut zéro whitelist email) ; JWT claim `app_metadata.role` pour éliminer le round-trip DB du proxy (optimisation perf, pas de besoin actuel).

- **Protocole appliqué** : 4 audits lecture seule défensifs avant chaque étape risquée, contre-vérification exhaustive C.3, validation `next build` séparée de `tsc --noEmit` pour le middleware, deux validations runtime Preview Vercel avant merge. 11 commits granulaires, 0 régression détectée.

### Chantier #7 — AI Observability étendue — clos le 2026-05-25

**Branche** : `claude/observ-utility-agents` — HEAD `4e6c361`. ✅ **Mergé dans `main`** (commit `4e6c361` présent dans l'historique de `main`).

**Objectif** — Étendre le wrapper `runAgent` de `src/lib/observability/` aux 4 agents utilitaires (non-canoniques) du codebase, en plus des 3 agents canoniques (`triage_mail`, `analyse_pj`, `rapport`) déjà instrumentés au chantier précédent. Tous les appels Anthropic du code applicatif (9 call sites) passent désormais par `runAgent`.

**Décisions d'architecture** — Option B-prime retenue : ajout d'une colonne SQL `agent_kind` (`'canonical' | 'utility'`, DEFAULT `'canonical'`) sur `agent_logs`, et élargissement du CHECK `agent_name` à 7 valeurs (3 canoniques + 4 utilitaires). Côté TypeScript : union `AgentName` étendue à 7 valeurs, type `AgentKind` exporté, champ optionnel `agentKind` dans `AgentRunInput` (default `'canonical'` runtime). Permet de filtrer le futur dashboard admin entre agents critiques (objectif précision 99 %) et utilitaires (monitoring coût/durée seulement).

**Périmètre instrumenté (4 nouveaux sites)** :

| Agent | Fichier | Modèle |
|---|---|---|
| `draft_reply` | `src/app/api/admin/mails/draft-reply/route.ts` | `claude-sonnet-4-6` |
| `sms_compose` | `src/app/api/admin/sms/compose/route.ts` | `claude-sonnet-4-6` |
| `notes_frais_extract` | `src/app/api/admin/notes-frais/extract/route.ts` | `claude-sonnet-4-20250514` |
| `assistant_chat` | `src/app/api/admin/assistant/chat/route.ts` | `claude-sonnet-4-6` |

**Migration SQL** — `db/migrations/2026-05-25_add_agent_kind_and_extend_agent_name.sql`, appliquée en prod le 2026-05-25 et versionnée. Lignes `agent_logs` préexistantes auto-marquées `'canonical'` par DEFAULT — aucune migration de données nécessaire.

**Pricing** — Ajout de `claude-sonnet-4-20250514` à `MODEL_PRICING` (mêmes tarifs que `claude-sonnet-4-6`, famille Sonnet 4.x). Tous les modèles utilisés sont désormais tarifés.

**Garanties préservées** — Comportement HTTP : chaque route conserve ses codes et payloads d'origine (incluant les 2 modes 502 de `notes_frais_extract` et le `warning` de fallback `rapport_json` d'`assistant_chat`). Zéro PII : `inputSummary` et `outputSummary` ne contiennent que booléens, longueurs, comptes et variantes — jamais de contenu de message, contexte, adresse, montant, nom, etc. Doc 02 §10 : tous les appels Anthropic du code applicatif sont désormais loggés.

**Reste à faire (post-merge PR)** — Test runtime de chaque route utilitaire après déploiement : vérifier qu'une ligne `agent_logs` avec `agent_kind='utility'` est bien créée par appel. ✅ Dashboard admin de monitoring : **construit au Chantier #8** (`/admin/observabilite`, FR — pas `/admin/observability`).

**Dette technique repérée hors-périmètre** — Lint global du repo : 67 problèmes pré-existants (42 erreurs, 25 warnings) dans `FactureFoxoPdf.tsx`, `google-calendar.ts`, `ponto.ts`, `sms.ts`, etc. Non bloquants (le gate CI est `tsc --noEmit`, pas le lint). À traiter dans un chantier dédié si on veut un jour gater sur lint.

### Chantier #8 — Dashboard observabilité — clos le 2026-05-25

**Branche** : `claude/observability-dashboard` (mergée via PR #5, merge commit `9ad35c2`).

**Objectif** — Construire l'UI de monitoring des appels Anthropic instrumentés aux chantiers #6 + #7. Le wrapper `runAgent` produit déjà des lignes dans `agent_logs` ; il manquait une page pour les exploiter.

**Découverte d'audit** — Une page `/admin/observabilite` (FR) de 314 lignes existait déjà, mais était orpheline (pas dans la Sidebar, accessible uniquement par URL directe), figée sur une fenêtre 24h, et lisait `agent_logs` en direct sans couche data. Décision : enrichir l'existant plutôt que créer un doublon `/admin/observability` en anglais. Cohérent avec la convention FR du repo (utilisateurs, facturation, comptabilite, interventions...).

**Périmètre livré** :

| Fichier | Action |
|---|---|
| `src/lib/observability/queries.ts` | nouveau (281 lignes) — `getObservabilityStats(period)`, `getAgentLogsList(options)`, `ALL_AGENT_NAMES`, `AGENT_KIND_BY_NAME`, `ObservabilityPeriod` |
| `src/lib/observability/index.ts` | +1 ligne (`export * from "./queries"`) pour cohérence du module |
| `src/app/admin/observabilite/page.tsx` | refactor (+144 / −38, 418 lignes au total) — sélecteur de période 7j/30j/90j/tout, nouvelle section « Par agent » (7 agents toujours présents même à 0), KPIs branchés sur `getObservabilityStats` |

**Architecture** — La couche data est server-only via `createAdminClient`. Agrégation côté JS plutôt qu'en RPC SQL tant que le volume reste petit (<10k lignes/période). La liste `ALL_AGENT_NAMES` garantit que tous les agents apparaissent dans la table « Par agent » même quand 0 appel sur la période, ce qui permet de voir d'un coup d'œil quels agents tournent et lesquels dorment.

**Garanties préservées** — La table brute Agents IA et la table Automatisations existantes fonctionnent exactement comme avant ; seule la fenêtre passe de 24h-figé à période sélectionnable. URLs rétrocompatibles : `/admin/observabilite?agent_status=error` reste valide. Nouveau paramètre `?period=` indépendant et optionnel (défaut `7d`). Aucun vocabulaire métier hardcodé (conforme doc 02).

**Notes typing** — Pendant le refactor, un cast `as [...]` sur `Promise.all` a été retiré car `Awaited<ReturnType<typeof autoJobsQuery>>` échouait à compiler (typeof d'un PostgrestFilterBuilder n'est pas une fonction). TypeScript infère correctement le tuple sans annotation. Import `type ObservabilityStats` retiré dans la foulée (devenu orphelin).

**Sanity check pré-merge** — `tsc --noEmit` vert, `npm run build` vert (page marquée Dynamic `ƒ` comme attendu), 0 erreur lint sur les fichiers modifiés, aucun TODO/FIXME résiduel.

**Reste à faire (hors-périmètre)** — Test runtime visuel en prod par Foxo après déploiement (ouvrir `/admin/observabilite`, vérifier les 4 périodes, vérifier que les 7 agents apparaissent dans la table « Par agent »). Câblage Sidebar (route reste orpheline). Étape 8.4 différée : brancher la table brute Agents IA sur `getAgentLogsList` et restreindre le filtre `?agent=` à `ALL_AGENT_NAMES`. Aucun blocage. **Mise à jour (PR #10, `5229f3b`)** : ✅ affichage `confidence_score` ajouté (KPI « Confiance < 0.7 » + colonne dédiée). `getAgentLogsList` reste exporté mais toujours non câblé.
