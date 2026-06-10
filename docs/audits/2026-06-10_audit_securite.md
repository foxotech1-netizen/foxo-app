# Audit de sécurité FoxO — 2026-06-10

- **Périmètre** : repo `foxo-app` complet (routes API, server actions, migrations RLS, usages service-role, secrets, validation d'entrées, tokens occupants, crons/webhooks, assistant IA, divers).
- **Méthode** : lecture seule du code à HEAD `a3ecd0e` (merge PR #67). Aucun code modifié. 94 routes API, 14 fichiers `'use server'`, ~45 migrations SQL analysés.
- **Limite** : les *grants* PostgREST effectifs et la config des buckets Storage ne sont pas dans le repo — les constats qui en dépendent sont marqués « à confirmer en prod ».

---

## A. Routes API (94 routes)

**Constat global positif** : les **61 routes `/api/admin/**`** ont toutes un guard `auth.getUser()` + `isAdminUser()` (ou `assertAdmin()`) → 403. Aucune route admin orpheline. Les **16 routes `/api/tech/**`** sont gardées (tech via `roleForEmail` ou `roleForUserId`, admin accepté en plus). Les routes Google OAuth/Drive/Calendar (hors webhook) sont admin-gated.

### [HAUTE — conditionnelle] `src/app/api/auth/send-email/route.ts:115-167` — hook Send Email **fail-open** si secret absent
- **Description** : la vérification (Authorization partagé en timing-safe **ou** signature Standard Webhooks HMAC-SHA256) n'est exécutée **que si `SUPABASE_AUTH_HOOK_SECRET` est défini** (`if (secret) { … } else { console.warn(…) }`, l.117 et l.164-167). Secret absent ⇒ la route accepte n'importe quel POST et envoie l'email.
- **Scénario** : si la variable manque (rotation ratée, nouvel environnement, préview Vercel sans env), n'importe qui peut POSTer `{ user: { email: "victime@x" }, email_data: { token: "<texte arbitraire>", email_action_type: "login" } }` → email « Code de connexion FoxO » envoyé depuis `noreply@send.foxo.be` à une adresse arbitraire avec contenu partiellement contrôlé = relais de phishing estampillé FoxO + épuisement du quota Resend.
- **Correctif** : fail-closed — si `SUPABASE_AUTH_HOOK_SECRET` est absent, retourner 500/503 et ne rien envoyer. (Comparer : `checkBearer` des crons fait correctement `if (!expected) return false`.)

### [MOYENNE — conditionnelle] `src/app/api/google/calendar-webhook/route.ts:19-23` — webhook calendar **fail-open** si token absent
- **Description** : `if (expectedToken && headerToken !== expectedToken) return 401;` — si `GOOGLE_CALENDAR_WEBHOOK_TOKEN` n'est pas défini, **aucune vérification**. La route fait ensuite des écritures service-role (`DELETE creneaux_disponibles` statut `libre` sur événements `cancelled`, upsert `parametres.gcal_sync_token`).
- **Scénario** : env absente ⇒ POST anonyme déclenche une boucle de sync Google (consommation API/quota) ; pas de suppression arbitraire directe (les ids viennent de Google, pas du caller), mais surface de DoS et corruption du sync token.
- **Correctif** : fail-closed (401/503 si env absente). Optionnel : vérifier aussi `X-Goog-Resource-Id` contre l'état d'abonnement persistant.

### [MOYENNE] `src/app/api/rapport/[id]/route.ts:12` + `src/lib/rapport/access.ts:31-62` — accès occupant au PDF par **UUID de ligne, sans TTL ni rate-limit**
- **Description** : `?occupant=<occupants.id>` donne accès au PDF du rapport (et `/api/facture/[id]` idem) tant que le statut est publié. C'est l'UUID **de la ligne** (≠ `confirmation_token` qui, lui, a un TTL de 30 j). Pas d'expiration, pas d'invalidation, pas de rate-limit.
- **Scénario** : un lien transféré/fuité (boîte mail revendue, forward) donne accès au rapport pour toujours. Énumération brute d'UUID v4 infaisable, donc le risque est la **persistance du lien**, pas la devinette.
- **Correctif** : utiliser `confirmation_token` (déjà TTLisé) comme clé d'accès occupant aux documents, ou ajouter un TTL/`token_sent_at` à la voie `occupant=`; ajouter un rate-limit léger sur la route.

### [BASSE] `src/app/api/cron/check-mails/preview/route.ts:9-17`, `src/app/api/cron/rappel-j1/preview/route.ts:7-18` — secret cron passé en **query string**
- **Description** : routes de preview prévues « depuis le navigateur » (commentaire l.7 de rappel-j1), le `CRON_SECRET` transite en URL.
- **Scénario** : le secret se retrouve dans les logs d'accès (Vercel), l'historique navigateur, d'éventuels proxys → réutilisable sur les vrais endpoints cron (déclenchement d'ingestion mail à volonté).
- **Correctif** : exiger le header `Authorization: Bearer` aussi sur les previews (ou supprimer les previews en prod).

### [BASSE] `src/app/api/address/autocomplete/route.ts` — proxy Nominatim public
- **Description** : route non authentifiée (par design, formulaire public /rdv). Rate-limit présent (`src/lib/rate-limit.ts` importé) — c'est le bon réflexe. La query utilisateur est loguée en `console.error` (l.44).
- **Scénario** : abus comme proxy de géocodage gratuit ; impact borné par le rate-limit.
- **Correctif** : rien d'urgent ; baisser le log en `debug`.

### [BASSE] Plusieurs routes renvoient `error.message` Supabase brut (ex. `acps/route.ts:95`, `assign/route.ts:34`, `delegues/route.ts:77`)
- **Description/Scénario** : fuite de détails internes (noms de contraintes, colonnes) vers le client — utile à un attaquant pour cartographier le schéma. Toutes ces routes sont admin-gated, donc impact réduit.
- **Correctif** : mapper vers des messages génériques côté routes exposées à des non-admins ; tolérable côté admin.

---

## B. Server actions (14 fichiers `'use server'`)

Rappel : chaque export d'un fichier `'use server'` est un **endpoint HTTP invocable** par tout utilisateur pouvant atteindre l'app — le guard doit être DANS l'action.

### [HAUTE] `src/app/admin/actions.ts:40-67` — `updateInterventionStatus` **sans aucun guard** + effets de bord service-role
- **Description** : aucune vérification `isAdminUser()`. L'update DB passe par le client cookie-bound (la RLS borne l'écriture), **mais** : la policy `tech_update_assigned_interventions` permet à un technicien de modifier SES interventions. Et l'effet de bord `notifyStatusChange(id, newStatut)` (l.58-63) tourne en **service-role** (loadContext → `createAdminClient`) et, pour `newStatut='rapport'`, appelle `dispatchRapportToSyndic` = **envoi réel de l'email + PDF au syndic** (`src/lib/email/notifications.ts:268-270`).
- **Scénario concret** : un compte technicien (ou compromis technicien) invoque la server action `updateInterventionStatus(<son intervention>, 'rapport')` → la RLS laisse passer l'update → le rapport (même non validé, même vide) part **réellement chez le syndic**, contournant intégralement la validation admin (`validateRapport`). C'est la violation directe de la règle métier « aucune notification avant validation admin ».
- **Correctif** : ajouter le guard admin en tête (`if (!user || !(await isAdminUser())) return { error: 'Accès refusé.' }`) **et** retirer le case `'rapport'` → dispatch de `notifyStatusChange` (voir constat dédié ci-dessous).

### [MOYENNE] `src/app/admin/actions.ts` — 5 autres actions sans guard explicite (défense en profondeur)
- `assignTechnician` (l.20), `getInterventionDocuments` (l.81), `createOrganisation` (l.197), `confirmAcpSuggestion` (l.487), `ignoreAcpSuggestion` (l.518).
- **Description** : pas de `isAdminUser()`. Les écritures passent par le client RLS-bound, donc l'impact est borné par les policies — mais : un technicien peut `assignTechnician` sur SES dossiers (se désassigner / réassigner via `tech_update_assigned_interventions`), `getInterventionDocuments` liste le Storage avec la session du caller (dépend des policies Storage, non versionnées), et toute évolution future des policies élargirait silencieusement la surface.
- **Scénario** : tech malveillant réassigne son dossier à un collègue (perturbation planning) ; énumération de documents si les policies Storage sont laxistes.
- **Correctif** : guard admin systématique en tête de **chaque** action du fichier (pattern déjà utilisé dans `planning/actions.ts` via `assertAdmin()` sur les 16 exports — s'aligner).

### [MOYENNE] `src/app/admin/actions.ts:148-170` — `uploadInterventionDocument(kind='rapport')` **contourne la validation** (connu, confirmé)
- **Description** : l'upload admin d'un PDF rapport force `interventions.statut='rapport'` puis `notifyStatusChange(id,'rapport')` → `dispatchRapportToSyndic` = envoi immédiat au syndic, **sans** passer par `validateRapport` (le cycle voulu est brouillon → valide → transmis).
- **Scénario** : un admin uploade un PDF de travail « pour le classer » → le syndic le reçoit aussitôt ; le statut `rapports.statut` reste incohérent (jamais `valide`).
- **Correctif** : pour `kind='rapport'`, poser le statut sans notifier (retirer l'appel `notifyStatusChange` ou introduire un statut intermédiaire), et laisser la transmission au flux explicite Valider → Envoyer.

### [MOYENNE] `src/lib/email/notifications.ts:268-270` — `case 'rapport': dispatchRapportToSyndic(...)` = transmission implicite (connu, confirmé)
- **Description** : tout passage au statut `'rapport'` via `notifyStatusChange` (statut manuel admin l.60, upload l.169) déclenche l'envoi réel. `dispatchRapportToSyndic` n'a **aucune précondition de statut interne** (la garde `valide` n'existe que dans la route execute de l'assistant, `execute/route.ts:110-127`).
- **Correctif recommandé** : supprimer ce case (la transmission a désormais ses chemins explicites : bouton « Envoyer au syndic » + action assistant `transmettre_rapport` avec re-check 409), ou y ajouter la précondition `rapports.statut === 'valide'`.

### [MOYENNE] `src/app/admin/actions.ts:254-281` — `saveRapportDraftFromAdmin` sans **garde de statut** (connu, confirmé)
- **Description** : `upsert` des 4 sections (`onConflict: 'intervention_id'`) **quel que soit** `rapports.statut`. Admin-gated, mais écrase silencieusement le contenu d'un rapport `valide` ou `transmis` (le PDF déjà transmis ne correspond plus à la base ; une retransmission enverrait un contenu différent non re-validé).
- **Scénario** : l'admin relance l'action rapide IA « Rédiger le rapport » sur un dossier transmis → le contenu validé/archivé est réécrit sans trace.
- **Correctif** : refuser l'upsert si `rapports.statut !== 'brouillon'` (ou si statut `valide`, repasser explicitement en `brouillon` avec confirmation + reset `valide_par/valide_at`).

### Flux publics / portail — corrects
- `src/app/rdv/actions.ts` (public assumé) : validation forte (regex email/téléphone, whitelist types/priorités, parse dates), **rate-limit 3/h/IP** (`checkRdvRateLimit`), service-role seulement après validation. ✔
- `src/app/o/actions.ts` (occupant) : autorisation par `confirmation_token` + **TTL 30 j** (`TOKEN_TTL_DAYS`, l.28/101) + statuts acceptant réponse. ✔
- `src/app/portal/actions.ts` : chaque mutation vérifie `getCurrentSyndic()` et scope `syndic_id = session.org.id` avant l'usage service-role. ✔
- `src/app/tech/actions.ts` : `assertOwnership(interventionId)` sur chaque export. ✔

---

## C. RLS (db/migrations)

### Points solides
- **FORCE ROW LEVEL SECURITY** sur les tables cœur : `acps, clients, delegues, interventions, occupants, organisations, photos_interventions, rapports, utilisateurs, dossiers_sinistres, agent_logs, automation_jobs, attachments, notifications, relances, rgpd_erasure_logs` (2026-05-11b/c, 05-13, 05-16, 05-30).
- Les 5 policies historiques `TO public` ont été **corrigées** en `TO authenticated` (migration `2026-05-11d`). ✔
- `mon_role()`/`mon_organisation_id()` durcies (`2026-05-24_harden_rls_helpers.sql` : STABLE + `SET search_path TO 'public'`). `is_admin()` basculée sur `utilisateurs.role` (`2026-05-25`). Les 15 helpers de `2026-05-11b` ont tous `search_path` figé. ✔

### [CRITIQUE — à confirmer en prod] 4 tables **sans aucune RLS** dans les migrations versionnées
- **Tables** : `mails_analyses` (analyses complètes des emails entrants : expéditeurs, résumés, téléphones/emails d'occupants extraits — PII), `intervention_mails` (métadonnées + snippets d'emails par dossier), `intervention_liens`, `observations_terrain`.
- **Fichiers** : `2026-05-11_mails_analyses.sql`, `2026-05-14_emails_syndic.sql` (intervention_mails), `2026-05-20_intervention_liens.sql`, `2026-05-29_observations_terrain.sql` — aucun `ENABLE ROW LEVEL SECURITY`, aucune policy, dans **aucune** migration.
- **Scénario** : sur Supabase, une table du schéma `public` sans RLS est exposée **en lecture/écriture via PostgREST aux rôles `anon` et `authenticated`** (grants par défaut). Si ces grants n'ont pas été révoqués manuellement, n'importe qui avec l'URL Supabase + la clé anon (publiée dans le bundle front via `NEXT_PUBLIC_SUPABASE_ANON_KEY`) peut lire l'intégralité des analyses d'emails et écrire dedans.
- **Correctif** : migration immédiate `ALTER TABLE … ENABLE/FORCE ROW LEVEL SECURITY` + policy `admin_all_*` (`is_admin()`) sur les 4 tables (elles ne sont consommées que par des routes admin/cron en service-role — le service-role bypasse la RLS, rien ne casse). Vérifier en prod : `SELECT tablename FROM pg_tables t WHERE schemaname='public' AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename=t.tablename);`

### [MOYENNE] `2026-05-11c_rls_core_tables.sql:362-366` — `auth_read_utilisateurs` : `SELECT … TO authenticated USING (true)`
- **Description** : **tout utilisateur authentifié** (délégué syndic, courtier, technicien, occupant disposant d'un compte) peut lire TOUTES les lignes `utilisateurs` : emails, téléphones, noms des admins et techniciens, `last_seen_at`.
- **Scénario** : un délégué partenaire énumère le staff FoxO (emails ciblables pour phishing, présence en ligne via `last_seen_at`).
- **Correctif** : restreindre aux colonnes/lignes nécessaires (ex. policy `USING (id = auth.uid() OR is_admin())` + une vue dédiée pour les besoins d'affichage des noms de techniciens).

### [BASSE] `2026-04-28_creneaux.sql:41-46` — `public_read_creneaux` : `SELECT TO authenticated USING (true)`
- Tout authentifié voit tous les créneaux, y compris `reserve` + `intervention_id`. La policy `anon` est correctement bornée à `statut='libre'` (l.52-54). Correctif : borner la policy authenticated aux créneaux libres ou aux rôles staff.

### [BASSE] `2026-05-30_user_preferences.sql` — `ENABLE` sans `FORCE` ROW LEVEL SECURITY
- Incohérent avec la convention du repo (FORCE partout ailleurs). Impact faible (table de préférences UI). Correctif : ajouter `FORCE`.

---

## D. Service-role (`createAdminClient`) — 71 fichiers

- **Routes/actions** : tous les usages dans `src/app/api/admin/**` et `src/app/admin/**` (sauf exceptions du point B) sont précédés d'un guard admin dans le même handler. Les routes `/api/tech/**` vérifient le rôle tech/admin avant l'usage. `o/actions.ts` vérifie le `confirmation_token` + TTL avant. `portal/actions.ts` vérifie `getCurrentSyndic()` avant. `rdv/actions.ts` est public par design avec validation + rate-limit. ✔
- **Librairies** (`src/lib/**` : dispatch, notifications, cron, observabilité, gmail, sms, drive…) : pas de guard local — **pattern assumé** « le guard est chez l'appelant ». Vérifié : tous les points d'entrée qui les appellent sont gardés (cron Bearer, routes admin, actions token-isées). Risque résiduel = un futur appelant non gardé ; documenter ce contrat en tête de fichier.
- **Cas limite** : `checkRapportAccess` (lib) utilise le service-role pour la voie occupant **avant** authentification — c'est voulu (pas de session occupant) et borné à un SELECT de vérification. ✔ ; `updateInterventionStatus` → `notifyStatusChange` → service-role **sans guard amont** = le vecteur du constat HAUTE du point B.

---

## E. Secrets

- **Aucun secret en dur** détecté (`sk-ant`, `whsec_`, clés Resend/Twilio/Google…) — les seules occurrences sont des commentaires de format. ✔
- **`NEXT_PUBLIC_*`** : uniquement `SUPABASE_URL`, `SUPABASE_ANON_KEY` (publique par design), `APP_URL`, `PORTAL_URL`, `SITE_URL`. Aucun secret exposé au bundle. ✔
- **`.env`** : seul `.env.example` est commité (placeholders vides) ; `.gitignore` exclut `.env*`. ✔
- [BASSE] `is_admin()` historique avec emails en dur a été remplacé (2026-05-25) mais la version emails reste lisible dans `2026-05-11b:163-173` — sans impact (CREATE OR REPLACE ultérieur), simple trace.

---

## F. Validation d'entrées

- **Bon** : `rdv/actions.ts` (regex strictes + whitelists), `execute/route.ts` (re-validation params + regex date/heure), `searchInterventions` (`sanitizeQuery` retire `,()*%` avant `.or(ilike)` — neutralise l'injection de filtres PostgREST), requêtes **Drive échappées** partout (`escapeQuery` : `\` et `'` — `google-drive.ts:36-37`, utilisé aux l.56, 120, 369, 472, 535), upload logo admin borné (2 MB + whitelist MIME, `upload-logo/route.ts:23-31`), upload rapport admin borné (10 MB + PDF only, `admin/actions.ts:133-134`).
- ### [MOYENNE] `src/app/api/tech/upload-photo/route.ts:56,95` — upload photo tech **sans limite de taille ni whitelist MIME**
  - Seule vérification : `file instanceof File && size > 0`. Le MIME est pris tel quel (`file.type || 'image/jpeg'`) et le fichier part sur Drive.
  - **Scénario** : un compte tech uploade des fichiers de 500 MB en boucle (épuisement quota Drive / temps serveur), ou des fichiers non-image avec MIME usurpé qui seront re-servis depuis Drive.
  - **Correctif** : `MAX_BYTES` (~15 MB) + whitelist `image/jpeg|png|webp|heic` comme le fait déjà upload-logo.
- [BASSE] Plusieurs routes admin acceptent des IDs sans vérifier le format UUID (la RLS/maybeSingle absorbe) — cosmétique.
- [BASSE] `searchAcps` / `searchOrganisations` (`planning/actions.ts:631`) remplacent `,()` mais pas `%` ni `*` — injection de wildcard bénigne (élargit la recherche), pas de fuite cross-tenant (admin-gated).

---

## G. Tokens occupants

- **Génération** : `randomBytes(16).toString('hex')` = 128 bits (`planning/actions.ts:277-279`, `notify-occupants.ts`). Entropie suffisante. ✔
- **Expiration** : `o/actions.ts:28,100-103` — TTL **30 jours** depuis `token_sent_at`, refus sinon. ✔
- **Invalidation après usage** : le token reste valable après réponse (par design : l'occupant peut modifier sa présence tant que le statut de l'intervention l'accepte — `STATUTS_ACCEPTANT_REPONSE`, l.112-115). Acceptable, borné par le TTL + le statut.
- **Périmètre de la route** : `respondAsOccupant` ne fait que mettre à jour la ligne occupant (conf/présence) + log `occupant_responses_log`. Pas d'accès cross-occupant. ✔
- ### [MOYENNE] (rappel du point A) la voie documents `?occupant=<row uuid>` est un **second canal** d'accès sans TTL — l'aligner sur `confirmation_token`.

---

## H. Crons / Webhooks

- `POST /api/cron/check-mails` (GitHub Actions */10) : Bearer `CRON_SECRET`, **fail-closed** (`if (!expected) return false`, l.11-29). ✔
- `POST/GET /api/cron/renew-calendar-watch` (quotidien) : Bearer `CRON_SECRET`, fail-closed. ✔
- `POST /api/cron/rappel-j1` : Bearer, fail-closed. ✔
- ### [MOYENNE] `calendar-webhook` : fail-open si env absente (détail au point A).
- ### [HAUTE — conditionnelle] `auth/send-email` : fail-open si env absente (détail au point A).
- [BASSE] previews cron : secret en query string (détail au point A).
- Note opérationnelle : les workflows cron sont actuellement **désactivés** côté GitHub (gel pendant le réencodage) — sans impact sur l'analyse du code.

## I. Assistant IA

- **Chat admin** (`api/admin/assistant/chat/route.ts:139-143`) : guard `isAdminUser()` → 403. ✔
- **Execute** (`api/admin/assistant/actions/execute/route.ts:24-28`) : guard admin **re-vérifié au clic**, indépendamment de la proposition. Les params sont re-validés (présence, regex date/heure). Chaque case délègue à l'action canonique qui porte SES propres gardes (`validateRapport` : re-check admin + `.eq('statut','brouillon')` ; `resendRapportToSyndic` : re-check admin ; `transmettre_rapport` : **re-check serveur `rapports.statut==='valide'` → 409** anti-double-envoi). ✔
- **Aucune mutation autonome** : les outils d'action du chat sont propose-only (`foxo-actions.ts` ne mute jamais ; `pendingAction` → carte → clic humain → execute). Vérifié sur les 5 actions. ✔
- **Assistant tech** (`api/tech/assistant/chat/route.ts:94`) : guard `roleForUserId === 'tech'` (rôle DB) ; outils = `FOXO_READ_TOOLS` uniquement (pas de Google, pas d'actions) ; le client Supabase passé aux outils est **cookie-bound** → cloisonnement RLS (`tech_select_assigned_interventions`) non contournable par prompt-injection : l'outil reçoit le client côté serveur, le modèle ne choisit que des arguments de recherche, et `buildInterventionContext`/résolution de ref sont eux aussi RLS-bound (double barrière). Outil inconnu → message d'erreur, pas de fallback Google. ✔
- [BASSE] Prompt-injection indirecte : les contenus Gmail lus par les outils admin (`google-read`) sont injectés dans le contexte modèle — un email entrant hostile peut tenter d'orienter l'assistant. Mitigé par le pattern propose-only (toute action exige un clic humain qui affiche le résumé), mais à garder en tête si des outils d'écriture Google sont ajoutés (backlog) : conserver la confirmation humaine systématique.
- ### [MOYENNE] Divergence de gardes tech : routes API `/api/tech/**` (hors assistant) = `roleForEmail` sur **whitelist en dur `TECH_EMAILS = ['tech1@foxo.be','tech2@foxo.be']`** (`roles.ts:28-31`) ; layout `/tech` = idem ; route assistant tech = rôle DB. Après la table rase (comptes tech1/tech2 supprimés), la whitelist référence des comptes morts et **tout nouveau technicien créé via `/admin/utilisateurs` aura le rôle DB mais ne passera ni le layout ni les routes `/api/tech/**`**. C'est d'abord un bug fonctionnel, mais une whitelist d'emails en dur est aussi un mauvais ancrage de sécurité (un compte auth recréé avec un de ces emails hériterait de l'accès tech sans rôle DB). **Correctif** : basculer layout + routes tech sur `roleForUserId`/rôle DB et supprimer `TECH_EMAILS`.

---

## J. Divers

- ### [MOYENNE] Aucun header de sécurité : ni `src/proxy.ts` ni `next.config.*` ne posent `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Strict-Transport-Security`, ni CSP.
  - **Scénario** : clickjacking du portail admin (iframe), sniffing MIME sur les PDF streamés.
  - **Correctif** : bloc `headers()` dans `next.config` (HSTS, nosniff, frame-ancestors 'none', Referrer-Policy strict-origin-when-cross-origin ; CSP en mode report d'abord).
- **Rate limiting** : présent sur `/rdv` (3/h/IP) et l'autocomplete. Absent sur la voie occupant (`/o/[token]`, `?occupant=`) et sur les routes de login (l'OTP Supabase a ses propres limites côté GoTrue — acceptable). [BASSE]
- **IDs internes** : UUID v4 partout (non prévisibles) ; les refs `2026-XXX` sont séquentielles mais ne servent jamais d'autorisation. ✔
- [BASSE] `getRequestIp` se fie à `x-forwarded-for` (spoofable hors plateforme gérée) — OK sur Vercel qui l'écrase, à revérifier si changement d'hébergeur.
- [BASSE] `verifySignature` (send-email) compare via `sigs.includes(expected)` — non timing-safe, contrairement au mode Authorization qui utilise `timingSafeEquals`. Marginal (HMAC), uniformiser.

---

## Tableau récapitulatif (gravité décroissante)

| # | Gravité | Constat | Localisation |
|---|---------|---------|--------------|
| 1 | **CRITIQUE** (à confirmer en prod) | 4 tables sans RLS : `mails_analyses`, `intervention_mails`, `intervention_liens`, `observations_terrain` — exposition PostgREST anon/authenticated probable | `db/migrations/2026-05-11_mails_analyses.sql`, `2026-05-14`, `2026-05-20`, `2026-05-29` |
| 2 | **HAUTE** | `updateInterventionStatus` sans guard ; un technicien peut déclencher l'envoi réel du rapport au syndic (statut `rapport` → dispatch service-role), contournant la validation admin | `src/app/admin/actions.ts:40-67` + `src/lib/email/notifications.ts:268-270` |
| 3 | **HAUTE** (conditionnelle env) | Hook Send Email fail-open si `SUPABASE_AUTH_HOOK_SECRET` absent → relais d'emails arbitraires signés FoxO | `src/app/api/auth/send-email/route.ts:115-167` |
| 4 | **MOYENNE** | Transmission implicite au syndic sur statut `rapport` (upload PDF admin / changement de statut) — bypass du cycle brouillon→valide→transmis | `src/app/admin/actions.ts:148-170` + `notifications.ts:268-270` |
| 5 | **MOYENNE** | `saveRapportDraftFromAdmin` écrase un rapport `valide`/`transmis` (aucune garde de statut) | `src/app/admin/actions.ts:254-281` |
| 6 | **MOYENNE** | 5 server actions admin sans guard (assignTechnician, createOrganisation, confirm/ignoreAcpSuggestion, getInterventionDocuments) | `src/app/admin/actions.ts:20,81,197,487,518` |
| 7 | **MOYENNE** | `auth_read_utilisateurs USING (true)` : tout authentifié lit emails/téléphones/présence de tout le staff | `db/migrations/2026-05-11c:362-366` |
| 8 | **MOYENNE** | Webhook Calendar fail-open si `GOOGLE_CALENDAR_WEBHOOK_TOKEN` absent | `src/app/api/google/calendar-webhook/route.ts:19-23` |
| 9 | **MOYENNE** | Upload photo tech sans limite de taille ni whitelist MIME | `src/app/api/tech/upload-photo/route.ts:56,95` |
| 10 | **MOYENNE** | Whitelist `TECH_EMAILS` en dur + divergence de gardes tech (layout/API email vs assistant rôle DB) — obsolète post-table-rase | `src/lib/auth/roles.ts:28-44` |
| 11 | **MOYENNE** | Accès documents occupant par UUID de ligne sans TTL ni rate-limit | `src/lib/rapport/access.ts:31-62` |
| 12 | **MOYENNE** | Aucun header de sécurité (CSP, HSTS, X-Frame-Options, nosniff) | `src/proxy.ts`, `next.config.*` |
| 13 | BASSE | Secret cron en query string sur les routes preview | `api/cron/*/preview/route.ts` |
| 14 | BASSE | `public_read_creneaux USING(true)` TO authenticated (créneaux réservés visibles) | `db/migrations/2026-04-28:41-46` |
| 15 | BASSE | `user_preferences` : ENABLE sans FORCE RLS | `db/migrations/2026-05-30_user_preferences.sql` |
| 16 | BASSE | Messages d'erreur Supabase bruts renvoyés au client | divers (`acps`, `assign`, `delegues`…) |
| 17 | BASSE | Comparaison de signature webhook non timing-safe (mode 2) | `api/auth/send-email/route.ts:111` |
| 18 | BASSE | Prompt-injection indirecte via contenus Gmail dans le contexte assistant (mitigée par propose-only) | `src/lib/assistant/tools/google-read.ts` |
| 19 | BASSE | `x-forwarded-for` comme source d'IP pour le rate-limit (OK sur Vercel) | `src/lib/rate-limit.ts:8-18` |

## Top 5 à corriger en priorité

1. **RLS sur les 4 tables nues** (`mails_analyses`, `intervention_mails`, `intervention_liens`, `observations_terrain`) — une migration `ENABLE/FORCE RLS + policy admin_all` suffit, zéro impact applicatif (accès actuels en service-role). Vérifier les grants en prod dans la foulée. *(#1)*
2. **Guard admin sur `updateInterventionStatus`** (+ les 5 autres actions de `admin/actions.ts`) — ferme le vecteur « un tech déclenche l'envoi du rapport au syndic ». *(#2, #6)*
3. **Fail-closed sur le hook Send Email** (et le webhook Calendar) : refuser la requête si le secret/token d'environnement est absent. *(#3, #8)*
4. **Supprimer la transmission implicite sur statut `rapport`** (`notifyStatusChange` case `'rapport'` + upload admin) : la transmission ne doit passer QUE par Valider → Envoyer / `transmettre_rapport` (garde 409 déjà en place). *(#4)*
5. **Garde de statut sur `saveRapportDraftFromAdmin`** (refus si ≠ `brouillon`) + restreindre `auth_read_utilisateurs`. *(#5, #7)*

---
*Audit réalisé en lecture seule le 2026-06-10 sur HEAD `a3ecd0e`. Aucun fichier applicatif modifié ; seul livrable : ce rapport.*
