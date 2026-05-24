# État du projet FoxO — snapshot fin de session 2026-05-24

- **Date du recap** : 2026-05-24
- **HEAD git** : `e35be32701833071d4fedf57c8ec2bdfa5942db9`
- **Branche** : `main`
- **Status** : clean (working tree propre)

## 3. Modules fonctionnels (état réel)

| Module | État | Détail |
|---|---|---|
| **Observabilité IA (agent_logs)** | ✅ | Wrapper `runAgent` posé dans `src/lib/observability/`. 5 call sites instrumentés sur les 3 agents canoniques (`triage_mail` ×3, `rapport` ×1, `analyse_pj` ×1). Table `agent_logs` + `automation_jobs` en prod avec RLS hardenée. Conforme à la règle doc 02 §10. |

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
7ddff39 feat(mails): wire confirm-and-create to insert occupants via safeInsertOccupants
31470ee feat(mails): editable occupants list in ConfirmCreateForm
77deb63 feat(mails): expose occupants_extraits to admin UI via analyses route
68b6727 docs(state): snapshot end of session 2026-05-20 — A1 + 1.a livrées, plan global 4 étapes
05a8a3b feat(mails): extract occupants[] in analyse-deep and store in occupants_extraits
9698d36 feat(db): add mails_analyses.occupants_extraits jsonb column
565e5a7 fix(mails): write sujet/expediteur/recu_le on mails_analyses upsert in analyse-deep
53e42d8 chore(db): version mails_analyses sujet/expediteur/recu_le columns (already in prod)
5c310d7 feat(devops): pre-push hook tsc --noEmit (Husky v9)
c920958 feat(observability): structured trace in errors[] for PJ pipeline (chantier #4, doc 02 §11)
afdda98 chore(db): version partial unique index on interventions.ref (chantier #5)
a162776 refactor(interventions/ref): single source of truth via nextRefForYear (chantier #5)
d7ecf25 fix(mails/chantier#4): unblock Vercel build for Agent 1 -> Agent 2 wiring
91f03ab feat(db): add contact_telephone and contact_email on interventions
8102bc2 feat(mails): branchement Agent 1 -> Agent 2 dans confirm-and-create (chantier #4)
b50c5b8 docs(etat-projet): close chantier #3 (Agent 2 — Analyse PJ)
433125a feat(agents/analyse-pj): drive upload + row update post-analyse (chantier #3 step 3)
35c173b feat(agents/analyse-pj): scaffold module + admin analyse API v2 (chantier #3 step 2)
c63d435 feat(agents/analyse-pj): scaffold module + admin analyse API (chantier #3 step 2)
a96fa26 docs(etat-projet): close chantier #2 (tables relances/notifications/attachments)
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
- Note : 2 conventions de prompt coexistent pour `triage_mail` (avec/sans `system:` séparé, avec/sans `temperature`). Harmonisation reportée à un chantier ultérieur.
