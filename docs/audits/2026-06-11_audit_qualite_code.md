# Audit qualité de code — FoxO — 2026-06-11

- **Type** : audit LECTURE SEULE. Aucun fichier applicatif modifié. Seul livrable = ce rapport.
- **HEAD audité** : `1537ad5` (branche `main`).
- **Branche** : `audit/qualite-code-2026-06-11`.
- **Outils** : `npx tsc --noEmit` (✅ 0 erreur), `npx eslint src/` (70 problèmes : 44 erreurs, 26 warnings), greps ciblés, exploration agents.
- **Convention de constat** : `[PRIORITÉ] — fichier:ligne — problème — risque — refactor (effort S/M/L)`.

> ⚠️ Ceci est un **audit**, pas un nettoyage. Aucun correctif appliqué — uniquement des propositions.

---

## Synthèse exécutive

**Bonne santé générale.** Le typecheck est vert, l'observabilité IA (`runAgent`, doc 02 §10) est **respectée partout** y compris la pipeline Rapport V2 (PR #76), et la discipline `vocab.ts` (zéro libellé métier en dur) est **tenue** côté portail. Les problèmes sont surtout : (1) duplication de la garde d'auth `api/tech/*`, (2) code mort résiduel (stubs Ponto / Briefing), (3) erreurs ESLint liées aux nouvelles règles React 19 hooks, (4) quelques valeurs en dur et best-effort silencieux.

Aucun problème de **priorité HAUTE pour la sécurité** détecté : les gardes RLS et ownership tiennent. Les items HAUTE ci-dessous concernent la **maintenabilité** (duplication à fort facteur de réplication).

---

## A. CODE MORT

### A1. `[MOYENNE]` — `src/lib/ponto.ts:36,45` — stub jamais importé
`connectPonto()` et `syncTransactions(_from, _to)` exportés mais **aucun importeur** dans `src/` (le toggle UI `pontoEnabled`/`pontoApiKey` dans `ParametresClient.tsx` ne stocke qu'un réglage, n'appelle jamais ces fonctions). Paramètres `_from`/`_to` non utilisés (ESLint `no-unused-vars`).
- **Risque** : faux signal de fonctionnalité « banque branchée » ; code qui ne compile aucune valeur.
- **Refactor** : conserver le fichier comme placeholder documenté OU le déplacer sous un dossier `experimental/` + commentaire « non branché ». Ne PAS supprimer si la feature Ponto est planifiée. Effort **S**.

### A2. `[MOYENNE]` — `src/lib/assistant/briefing.ts:87` — `getBriefing()` jamais appelé
Export `getBriefing()` (passe par `runAgent`, donc tracé) mais **aucun importeur** dans `src/`. Les 13 succès historiques dans `agent_logs` (cf. ETAT_PROJET) proviennent d'un appelant retiré depuis.
- **Risque** : agent canonique orphelin ; coût de maintenance d'un chemin IA mort.
- **Refactor** : soit rebrancher sur le Tableau de bord (cf. A3), soit retirer `briefing.ts` + `BriefingIA.tsx` ensemble. Effort **S**.

### A3. `[MOYENNE]` — `src/components/admin/BriefingIA.tsx:42` — composant jamais rendu
`BriefingIA` défini et exporté mais **jamais importé ni rendu**. Contient un handler stub `console.log('[BriefingIA] action déclenchée :', key)` (`:47`).
- **Risque** : composant vestige + `console.log` résiduel.
- **Refactor** : supprimer en bloc avec A2, ou rebrancher. Effort **S**. (NB : à distinguer de `ChatIA.tsx`, lui bien rendu sur le Dashboard.)

### A4. `[BASSE]` — exports/vars non utilisés signalés par ESLint
- `src/lib/facturation/FactureFoxoPdf.tsx:26` — `applyRemise` défini, jamais utilisé.
- `src/lib/google-calendar.ts:169` — `_technicienId`, `_from`, `_to` non utilisés.
- `src/lib/notifications.ts:25` — type `ParticulierContact` importé non utilisé.
- **Risque** : bruit, confusion sur l'API réelle des modules.
- **Refactor** : retrait des symboles morts (ou préfixe `_` cohérent). Effort **S**.

> `src/lib/observability/pricing.ts` est **VIVANT** (importé par `observability/index.ts` + `agent-logger.ts`) — ce n'est PAS du code mort, mais voir D3/H3 pour ses valeurs non vérifiées.

---

## B. DUPLICATION

### B1. `[HAUTE]` — garde d'auth + ownership `api/tech/*` répliquée dans 9 routes
Pattern `auth.getUser()` → lookup `utilisateurs` par email lowercase → ownership `interventions.technicien_id === techRow.id` copié-collé.
- `src/app/api/tech/observations/route.ts:24`, `observations/[id]/route.ts:34`, `observations/[id]/photos/route.ts:29`, `photos/[id]/route.ts:42`, `photos/route.ts:29`, `facture/route.ts:79`, `rapport-docx/route.ts:56`, `interventions/[id]/notes/route.ts:26`, `upload-photo/route.ts:35`.
- **Risque** : une faille corrigée sur une route ne l'est pas sur les 8 autres ; divergence des messages/statuts d'erreur.
- **Refactor** : extraire `src/lib/auth/tech-helpers.ts` → `getTechIdFromUser()`, `verifyTechOwnsIntervention()`, `verifyTechOwnsObservation()`, `lookupTechByEmail()`. Effort **M**.

### B2. `[MOYENNE]` — filtre de visibilité org dupliqué (portail + admin)
Clause `or('syndic_id.eq…,organisation_id.eq…[,id.in.(…)]')` répétée :
- `src/app/portal/page.tsx:42`, `portal/interventions/page.tsx:78-80`, `portal/interventions/[id]/page.tsx:51`.
- Variante legacy `syndic_id_ref` : `src/app/admin/actions.ts:716`, `api/admin/syndics/[org_id]/acps/route.ts:29`.
- **Risque** : règle de visibilité sécurité divergente entre liste / détail / accueil ; oubli du mandat dossier sur une vue.
- **Refactor** : `src/lib/portal/org-visibility.ts` → `buildOrgVisibilityFilter(orgId, mandatedIds)`. Effort **S**.

### B3. `[MOYENNE]` — état occupants (add/remove/update) dupliqué
Logique identique dans `src/app/admin/planning/CreateInterventionModal.tsx:80` et `src/app/admin/mails/ConfirmCreateForm.tsx:74` (init tableau + `addOccupant`/`removeOccupant`/`updateOccupant`).
- **Risque** : divergence de validation occupants entre les 2 formulaires.
- **Refactor** : hook `src/hooks/useOccupants.ts`. Effort **S**.

### B4. `[BASSE]` — regex de validation date/heure répliquées
`/^\d{4}-\d{2}-\d{2}$/` & `/^\d{2}:\d{2}$/` dans `api/admin/planning/dispos/route.ts`, `api/admin/interventions/[id]/schedule/route.ts`, `api/tech/notes-frais/route.ts`.
- **Refactor** : `src/lib/validation/date-format.ts` (constantes + type guards). Effort **S**.

### B5. `[BASSE]` — réservation de créneau (`statut='reserve'`) dupliquée
`src/app/admin/planning/actions.ts:210` et `:393`.
- **Refactor** : helper `reserveCreneau()`. Effort **S**.

---

## C. TODO / FIXME / HACK actifs (inventaire)

14 occurrences. Actives & significatives :

| Priorité | Fichier:ligne | Note |
|---|---|---|
| MOYENNE | `src/lib/ponto.ts:35,42` | OAuth2 + sync transactions non implémentés (cf. A1) |
| MOYENNE | `src/lib/observability/pricing.ts:10` | « vérifier valeurs réelles + taux de change » — prix LLM non confirmés (cf. D3) |
| MOYENNE | `src/lib/cron/check-mails.ts:556` | `intervention_id` reste null (observabilité chantier 1) |
| BASSE | `src/app/api/admin/mails/[id]/analyze/route.ts:109` | cible non finalisée, renvoie au TODO `check-mails.ts` |
| BASSE | `src/app/admin/parametres/ParametresClient.tsx:956` | pointe vers le branchement Ponto à venir |
| BASSE | `src/app/rdv/RdvClient.tsx:279,292`, `rdv/layout.tsx:49` | TODO design system (cosmétique) |

Les autres (`2026-XXX`, `whsec_XXX`) sont des **placeholders de documentation/format**, pas des dettes.

---

## D. TYPAGE

### D1. `[INFO]` — `tsc --noEmit` : **0 erreur**. ✅
Aucun warning de compilation. Base saine.

### D2. `[BASSE]` — ~31 usages `any` / `as any` / `as unknown`
Concentrés dans les mappings Supabase (`as Type[]`) et parsing JSON IA. La plupart sont des casts de frontière DB acceptables, mais à surveiller.
- **Risque** : casts masquant un désalignement schéma réel (rappel : `reference_externe` = vraie colonne, alors que doc 04 décrit à tort `ref_syndic`).
- **Refactor** : remplacer les `as Type[]` répétés par des helpers de parsing typés (zod-lite) aux points chauds. Effort **M** (incrémental, non urgent).

### D3. `[MOYENNE]` — `src/lib/observability/pricing.ts` — prix LLM en dur non vérifiés
`MODEL_PRICING` alimente le coût affiché dans l'observabilité ; le TODO L10 admet que les valeurs/taux ne sont pas confirmés.
- **Risque** : coûts `agent_logs` faux → décisions biaisées.
- **Refactor** : vérifier la grille tarifaire réelle + source unique. Effort **S**.

### D4. `[BASSE]` — `src/lib/sms.ts:37` — `let dbConfig` jamais réassigné (ESLint `prefer-const`, **error**)
Trivial. Effort **S**.

---

## E. ESLINT (agrégé)

`npx eslint src/` → **70 problèmes (44 erreurs, 26 warnings)**. Catégories regroupées :

| Règle | ~Count | Sévérité | Commentaire |
|---|---|---|---|
| `react-hooks/set-state-in-effect` | 21 | error | Nouvelle règle React 19 — `setState` synchrone dans `useEffect` (ex. `useMediaQuery.ts:23`). Cascading renders. |
| `react-hooks/refs` | 8 | error | Accès refs pendant le render. |
| `react-hooks/purity` | 8 | error | Effets de bord pendant le render. |
| `@typescript-eslint/no-unused-vars` | 19 | warning | Vars/exports morts (cf. A4). |
| `prefer-const` | 4 | error | `let` jamais réassigné (cf. D4). |
| `jsx-a11y/alt-text` | 4 | warning | `<Image>` PDF sans `alt` (`RapportPdf.tsx`, `FactureFoxoPdf.tsx`). |
| `react-hooks/immutability` / `exhaustive-deps` | 4 | error/warn | Deps & mutations hooks. |
| `react/no-unescaped-entities` | 1 | error | Apostrophe non échappée. |

- **Risque** : les 21 `set-state-in-effect` + `purity`/`refs` (≈37 erreurs) sont des **patterns React fragiles** révélés par React 19/Next 16 — surtout dans les composants client de hooks custom et modales. Pas bloquant au build (eslint ≠ build) mais source de bugs de re-render subtils.
- **Refactor** : passe ciblée sur `src/hooks/*` (`useMediaQuery`) et les modales planning. Beaucoup de `set-state-in-effect` se corrigent en initialisant l'état via `useState(() => …)` ou en supprimant l'effet inutile. Effort **M** global, **S** par fichier.

---

## F. GESTION D'ERREURS

### F1. `[INFO]` — la majorité des `catch {}` vides sont LÉGITIMES
Sur ~337 `catch` (dont ~40 vides) : l'échantillon montre des usages corrects — parsing de body JSON → `400 'Body JSON invalide'` (`api/admin/acps/route.ts:58`, `interventions/[id]/assign/route.ts:25`), géocodage → `return null` (`confirm-and-create:79`). Pas de swallow problématique systémique.

### F2. `[MOYENNE]` — best-effort silencieux sans aucune trace
Quelques `.catch(() => {})` **sans commentaire ni log** :
- `src/app/admin/InterventionsClient.tsx:619` — `.catch(() => {})`.
- Plusieurs `.catch(() => { /* noop */ })` (MailsClient, PlanningCalendar) — tolérés car UI dégradable, mais zéro métrique d'échec.
- **Risque** : pannes réseau/API invisibles côté ops (rappel pipeline mails : échecs partiels opaques).
- **Refactor** : au minimum `console.warn('[ctx] …', e)` dans chaque catch best-effort, idéalement un compteur. Effort **S**.

### F3. `[MOYENNE]` — analyse photo Rapport V2 : échecs ignorés sans compteur agrégé
`src/app/tech/interventions/[id]/generate-action.ts:233` — `Promise.allSettled` sur `analysePhoto`, les rejets sont silencieusement ignorés (« Best-effort : les échecs sont ignorés »). `runAgent` trace chaque appel individuel, mais le nombre de photos **échouées** n'est pas remonté à l'utilisateur ni résumé.
- **Risque** : rapport généré avec des photos non analysées sans que le tech le sache.
- **Refactor** : compter les `status==='rejected'` et l'exposer dans `outputSummary` / un avertissement UI. Effort **S**.

### F4. `[INFO]` — best-effort notifications correctement tracés ✅
`notifyStatusChange`/`notifyOccupants…` sont en `try/catch` avec `console.warn`/`console.error` contextualisés (`planning/actions.ts:450`, `confirm-and-create:505`, `o/actions.ts:181`). Bon pattern.

### F5. `[BASSE]` — floating promises intentionnelles
`void ask(...)`, `void startUpload(...)` (ChatIA, DocumentsBlock) sont des fire-and-forget avec gestion interne. Acceptable ; à garder sous l'œil si la gestion d'erreur interne disparaît.

---

## G. COHÉRENCE ARCHITECTURE

### G1. `[INFO]` — `runAgent` (doc 02 §10) respecté PARTOUT ✅
Tous les appels Anthropic (`new Anthropic` + `messages.create`) sont **encapsulés dans `runAgent`** : `generate-action.ts:281` (rapport V2), `analyse-photo.ts:167`, `briefing.ts:49`, `mails/analyse-deep`, `mails/[id]/analyze`, `draft-reply`, `sms/compose`, `notes-frais/extract`, `assistant/chat` (admin+tech), `analyse-pj/analyze-one`, `check-mails`. **Aucun appel IA hors `runAgent`.** Excellente discipline.

### G2. `[INFO]` — `vocab.ts` : zéro libellé métier en dur côté portail ✅
Le grep ne remonte que des **fallbacks de type** `'syndic'` (`portal/page.tsx:120`, `layout.tsx:26`), pas des libellés. Les libellés passent par `useVocab()` / `referenceLabel` partout (DossierPortalClient, InterventionsPortalClient, NewRequestClient). Conforme.

### G3. `[INFO]` — `createAdminClient` / gardes
Les inserts service-role (portal/actions, api/tech/facture) sont gardés par des assertions amont (`getCurrentSyndic`, `getCurrentTech`, ownership). Pas de violation détectée.

### G4. `[BASSE]` — message d'erreur incohérent `submitRequest`
`src/app/portal/actions.ts` retourne « Compte non lié à un partenaire. » vs « …à un syndic. » selon l'action — terminologie flottante (mineur, UX).

---

## H. FRAGILITÉ

### H1. `[MOYENNE]` — `GOOGLE_DRIVE_RAPPORTS_FOLDER_ID` / `_FACTURES_FOLDER_ID` lus en dur dans 8+ points
`src/lib/google-drive.ts` (l.192, 223, 264, 288, 314, 360, 413-414) + `drive/create-intervention-folder.ts:66` relisent `process.env` à chaque fonction, chacune avec son propre guard.
- **Risque** : dépendance forte à un `drive_folder_id` non fiable (confirmé fragile) ; en cas d'env absente, échec dispersé et messages variables.
- **Refactor** : centraliser dans `src/lib/drive/config.ts` → `getDriveFolders()` validé une fois (fail-fast au boot). Effort **S**.

### H2. `[BASSE]` — coût SMS en dur `~0.05€` — `src/lib/sms.ts:80`
Estimation Twilio figée dans le code.
- **Refactor** : déplacer en config/constante documentée. Effort **S**.

### H3. `[MOYENNE]` — voir D3 : `MODEL_PRICING` en dur non vérifié (fragilité de coût).

### H4. `[BASSE]` — ordres d'opérations best-effort post-insert
`submitRequest` (portal) et `dispatchRapportToSyndic` font des inserts secondaires (occupants, dossier, mark transmis) en best-effort après l'insert principal : si l'étape 2 échoue, l'état est partiel mais l'appel renvoie `ok`. Documenté, mais à surveiller (cas vide/partiel).

---

## I. COHÉRENCE RAPPORT V2 (PR #76)

### I1. `[INFO]` — pipeline tracée via `runAgent` ✅
`analysePhoto` (passe 1, `analyse-photo.ts:167`) **et** l'agent `rapport` v2 (passe 2, `generate-action.ts:281`) passent par `runAgent` avec `inputSummary`/`outputSummary` riches. Doc 02 §10 respecté (confirmé L281).

### I2. `[INFO]` — gestion d'échec propre ✅
`generate-action.ts:280-348` : `try/catch` distinguant `JSON parse:` (→ « Réponse non parsable, réessaie ») de l'erreur Anthropic générique ; **boucle de retry x2** sur JSON invalide ; `ActionResult` typé. `techniquesLabelsToKeys` filtré/validé (`asLabels`).

### I3. `[INFO]` — pas de rupture du cycle rapport admin ✅
`generateRapport` (V2) **produit le contenu** mais ne touche pas `interventions.statut` ni `rapports.statut`. La bascule `brouillon` reste `publishRapport` (tech), `valide`/`transmis` côté admin. Le correctif récent (rapport visible syndic ssi transmis, PR #58) **n'est pas impacté** : V2 alimente le brouillon, la RLS reste la barrière.

### I4. `[MOYENNE]` — échecs d'analyse photo non comptés (cf. F3)
Seul point d'amélioration de la pipeline : remonter le nombre de photos non analysées.

---

## Tableau récapitulatif (trié par priorité)

| # | Prio | Domaine | Fichier(s) | Effort |
|---|---|---|---|---|
| B1 | **HAUTE** | Duplication | `api/tech/*` (9 routes) garde auth/ownership | M |
| A1 | MOYENNE | Code mort | `lib/ponto.ts` | S |
| A2 | MOYENNE | Code mort | `lib/assistant/briefing.ts` | S |
| A3 | MOYENNE | Code mort | `components/admin/BriefingIA.tsx` | S |
| B2 | MOYENNE | Duplication | filtre visibilité org (portal+admin) | S |
| B3 | MOYENNE | Duplication | état occupants (2 formulaires) | S |
| D3 | MOYENNE | Typage/coût | `observability/pricing.ts` valeurs | S |
| E | MOYENNE | ESLint | 37 erreurs react-hooks (set-state-in-effect…) | M |
| F2 | MOYENNE | Erreurs | `.catch(()=>{})` sans trace | S |
| F3/I4 | MOYENNE | Erreurs | échecs analyse photo non comptés | S |
| H1 | MOYENNE | Fragilité | `GOOGLE_DRIVE_*_FOLDER_ID` dispersés | S |
| C | MOYENNE | Dette | TODO Ponto / pricing / check-mails | — |
| A4 | BASSE | Code mort | unused vars (applyRemise, _technicienId…) | S |
| B4 | BASSE | Duplication | regex date/heure | S |
| B5 | BASSE | Duplication | réservation créneau | S |
| D2 | BASSE | Typage | ~31 `any`/casts | M |
| D4 | BASSE | ESLint | `sms.ts` prefer-const | S |
| F5 | BASSE | Erreurs | floating promises (OK) | — |
| G4 | BASSE | Cohérence | message erreur submitRequest | S |
| H2 | BASSE | Fragilité | coût SMS en dur | S |
| H4 | BASSE | Fragilité | inserts best-effort partiels | — |

**Positifs confirmés (aucune action)** : `tsc` vert (D1), `runAgent` partout (G1), `vocab` sans hardcode (G2), gardes service-role (G3), Rapport V2 tracé + isolé du cycle (I1-I3), notifications best-effort tracées (F4).

---

## Top 10 refactors par rapport valeur / effort

1. **B1 — Helper auth tech (`lib/auth/tech-helpers.ts`)** — élimine 9 copies d'une garde sécurité ; valeur HAUTE, effort M. *Le meilleur ROI sécurité/maintenance.*
2. **B2 — `buildOrgVisibilityFilter()`** — unifie la règle de visibilité RLS portail/admin ; valeur HAUTE (cohérence sécurité), effort S.
3. **A2+A3 — Supprimer/rebrancher Briefing (lib + composant)** — retire un agent IA mort en un geste ; valeur MOY, effort S.
4. **H1 — `getDriveFolders()` centralisé fail-fast** — supprime 8 lectures env dispersées, panne Drive lisible ; valeur MOY, effort S.
5. **F3/I4 — Compter les échecs d'analyse photo** — fiabilise la pipeline rapport V2 fraîchement livrée ; valeur MOY, effort S.
6. **D3/H3 — Vérifier `MODEL_PRICING`** — rend les coûts `agent_logs` exploitables ; valeur MOY, effort S.
7. **E — Passe react-hooks sur `src/hooks` + modales planning** — corrige 37 erreurs de re-render React 19 ; valeur MOY, effort M (S/fichier).
8. **B3 — `useOccupants()` hook** — synchronise 2 formulaires d'occupants ; valeur MOY, effort S.
9. **F2 — Logguer les `.catch(()=>{})` best-effort** — rend visibles les pannes silencieuses ; valeur MOY, effort S.
10. **A1/C — Statuer sur Ponto** (placeholder assumé vs retrait) — clarifie une feature fantôme ; valeur BASSE, effort S.

---

*Fin de l'audit. Aucune modification de code applicatif effectuée — propositions uniquement.*
