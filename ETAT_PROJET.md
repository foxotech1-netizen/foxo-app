# État du projet FoxO — snapshot fin de session 2026-05-25

- **Date du recap** : 2026-05-25
- **HEAD git** : `3312cac` (merge commit PR #3)
- **Branche** : `main`
- **Status** : clean (working tree propre)
- **Production** : déployée par Vercel sur push `main`, validée runtime sur deux Previews (post-3.4b et post-3.5)

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

- **HEAD** : `7ddff39` (feat(mails): wire confirm-and-create to insert occupants via safeInsertOccupants)
- **Branche** : `main`, working tree clean, aligné `origin/main`.
- **`mails_analyses`** : colonnes mail metadata + `occupants_extraits` désormais peuplées par Agent 1 à chaque analyse fraîche. Le champ `occupants_extraits` est remonté jusqu'à l'UI (route analyses + type `MailAnalyse`).
- **`occupants`** : alimentée par `confirm-and-create` (flux mail) en plus du cron `check-mails` et de `/admin/planning`. Insertion via `safeInsertOccupants` (auto-strip cascade anti-drift).

## 🧾 20 DERNIERS COMMITS

```
3312cac Merge pull request #3 from foxotech1-netizen/claude/lucid-ritchie-cqKIY
57a22a9 refactor(auth): remove ADMIN_EMAILS + SUBDOMAIN_FOR_ROLE, migrate tech||admin checks
f56d688 refactor(auth): remove ADMIN_EMAILS from sendOtp's isHardcoded gate shortcut
f1fe5e8 refactor(auth): migrate 5 routing/access call-sites to roleForUser/roleForUserId
315a019 feat(auth): add roleForUserId(userId) middleware-compatible helper
a7fe5e9 feat(auth): add roleForUser() server helper backed by utilisateurs.role
f203001 refactor(auth): migrate 3 atypical admin gates missed by 3.3b grep
ecc62f5 refactor(auth): migrate inline roleForEmail!=='admin' checks to isAdminUser()
c2c9d32 refactor(auth): 10 local assertAdmin functions now check via isAdminUser()
e0d4ba2 refactor(auth): assertAdmin() now uses isAdminUser() instead of ADMIN_EMAILS whitelist
9e1cde0 feat(auth): add isAdminUser() server helper backed by utilisateurs.role
df8898b feat(db): switch is_admin() from email whitelist to utilisateurs.role
5e252da feat(db): seed 2 admin users in utilisateurs table
fd287fb docs(audits): archive audit is_admin() refacto (2026-05-24)
62fdc9b docs(etat): clôture Chantier #5 — harmonisation conventions prompt triage_mail
c25f05a refactor(mails): align CS2 analyse-deep max_tokens 2048 -> 4096 (triage_mail convention)
ef4f81b refactor(mails): align CS1 check-mails on triage_mail prompt convention
5f96b9a refactor(mails): align CS3 analyze on triage_mail prompt convention
8b2596e docs(roles): clôture Chantier #4 — drift user_role infirmé + cartographie 3 vocabulaires
7b7a94f feat(rls): harden mon_role/mon_organisation_id avec STABLE + search_path figé
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
