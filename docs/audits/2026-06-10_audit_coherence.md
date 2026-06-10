# Audit de cohérence fonctionnelle FoxO — 2026-06-10

- **Périmètre** : écarts entre ce que l'UI promet, ce que le code fait réellement, et le workflow métier attendu. Famille de référence : le bug `RapportPanel`/`publishRapport` (UI annonçait une notification jamais envoyée), corrigé par PR #68.
- **État** : `main` à HEAD `9e15b6c` (post-merge #68 `096e4c6` + cleanup policies `9e15b6c`). Les fix sécurité de #68 sont intégrés ; cet audit reflète donc l'état **post-#68** (la transmission implicite du rapport est déjà supprimée).
- **Méthode** : lecture seule. Aucun fichier applicatif modifié. Seuls écrits : la migration de cleanup (tâche 0, sur main) et ce rapport.

---

## A. Cycle de vie de l'intervention

### Cartographie des transitions de `interventions.statut`

| Statut cible | Déclencheur(s) | Surface |
|---|---|---|
| `nouvelle` | `rdv/actions.submitRdv` ; `portal/actions.submitRequest` ; `mails/confirm-and-create` ; cron `check-mails` (auto-création) | public, portail partenaire, admin (mail), cron |
| `attente` | `interventions/[id]/schedule` (pose créneau) ; `planning/freeSlot` (retour arrière, l.507) | admin |
| `confirmee` | `planning/createInterventionFromSlot` (l.325/371) ; `confirm-mail` (l.144) ; `accept-counter-proposal` (l.128/252) ; `calendar/events` (l.150) ; `calendar-import` (l.98) | admin, agenda |
| `realisee` | `tech/actions` fin de mission (`ended_at` + l.74) | portail tech |
| `rapport` | `tech/actions.publishRapport` (l.140) ; `admin/actions.uploadInterventionDocument` kind=rapport (l.173) | tech, admin |
| `cloturee` | `admin/actions.uploadInterventionDocument` kind=facture (l.173) ; `admin/facturation.emitFacture` (l.454) | admin |
| `en_suspens` | `admin/actions.updateInterventionStatus` (manuel) | admin |

### [FORT] `interventions.statut` et `rapports.statut` divergent durablement — `src/app/tech/actions.ts:140`, `src/app/admin/actions.ts:331`
- **Attendu** : l'avancement du rapport (brouillon → valide → transmis) fait progresser le dossier vers sa clôture.
- **Réel** : `publishRapport` met `interventions.statut='rapport'` une fois. Ensuite `validateRapport` (rapports → `valide`) et `resendRapportToSyndic` (rapports → `transmis`) **ne touchent jamais `interventions.statut`**. Un dossier reste donc en `rapport` alors que son `rapports.statut` vaut `valide` ou `transmis`. La seule sortie vers `cloturee` est l'**émission d'une facture** (`emitFacture`/upload facture). → Un rapport transmis au syndic mais sans facture reste éternellement « en rapport » dans le pipeline (faux « en attente d'action »).
- **Correctif** : à la transmission (`dispatchRapportToSyndic` succès / `resendRapportToSyndic`), passer l'intervention en `cloturee` (ou un statut « transmis » dédié), ou au minimum dériver l'affichage du pipeline depuis `rapports.statut` plutôt que de laisser `interventions.statut='rapport'` figé.

### [MOYEN] Upload PDF rapport admin ne crée pas de ligne `rapports` → invisible dans la file de validation — `src/app/admin/actions.ts:142-173`
- **Attendu** : tout rapport « posé » par l'admin suit le même cycle de validation.
- **Réel** : `uploadInterventionDocument(kind='rapport')` écrit le PDF dans Storage et met `interventions.statut='rapport'`, **sans insérer/mettre à jour `rapports`**. Or `/admin/validation` (l.114-118) liste les rapports via `rapports.statut IN ('brouillon','valide')`. Un rapport uploadé en PDF n'apparaît donc **jamais** dans la file de validation et ne peut être ni validé ni transmis par les boutons du drawer (qui lisent `rapports.statut`). C'est un chemin de rapport « fantôme ».
- **Correctif** : soit interdire l'upload manuel de rapport quand le flux tech/IA est la source de vérité, soit créer/mettre à jour la ligne `rapports` (statut `brouillon`) à l'upload pour réintégrer le cycle.

### [FAIBLE] `realisee` sans automatisation aval — `src/app/tech/actions.ts:74`
- `realisee` n'est atteint que par la fin de mission tech et ne déclenche aucune notification ni transition automatique. C'est cohérent (le tech enchaîne avec le rapport), mais un dossier `realisee` sans rapport publié n'a aucun rappel/relance : risque de dossiers « réalisés » oubliés. Correctif : alerte admin sur `realisee` ancien sans rapport.

---

## B. Notifications — inventaire des envois sortants

| Envoi | Déclencheur | Destinataire | Trace |
|---|---|---|---|
| `notifyNouvelle` (Resend) | statut → `nouvelle` | **admin** `info@foxo.be` (hardcodé, l.8) | non loguée en base |
| `notifyConfirmee` (Resend) | statut → `confirmee` | demandeur (cascade ACP/syndic/particulier, type `communication`) | non loguée |
| `notifyCloturee` (Resend) | statut → `cloturee` | demandeur | non loguée |
| `dispatchRapportToSyndic` (Resend + PDF) | bouton « Envoyer au syndic » / assistant `transmettre_rapport` | syndic (email rapport) | `rapports.transmis_at/transmis_a` ✔ |
| reply-in-thread (Gmail) | idem, si `source='mail'` | expéditeur du fil d'origine | non loguée (best-effort) |
| `sendRdvEmail` (`lib/email/rdv.ts`) | soumission /rdv public | demandeur particulier | — |
| `notify-occupants` (SMS/WhatsApp/email) | action admin « relancer occupants » | occupants | `sms_logs` + `occupants.token_sent_at` ✔ |
| cron `rappel-j1` (SMS/WhatsApp/email) | J-1 des `confirmee` | occupants | `sms_logs` ✔ |
| `notify-syndic-response` | réponse occupant | syndic | — |
| `notify-partner-message` | message portail | partenaire/admin | `messages` |
| invite délégué (Resend) | bouton inviter | délégué | `delegues.invite_sent_at` ✔ |
| `send-rappel` facture (Resend) | relance facture | client | `factures` |

### [MOYEN] Double notification possible de `confirmee` — `planning/actions.ts:447` + `confirm-mail/route.ts:144` + `accept-counter-proposal`
- **Réel** : plusieurs chemins posent `confirmee`. `createInterventionFromSlot` appelle explicitement `notifyStatusChange(id,'confirmee')` (l.447). Les routes `confirm-mail` et `accept-counter-proposal` posent `confirmee` puis (selon le chemin) renvoient des emails dédiés. Si deux chemins se succèdent (ex. confirmation manuelle après une auto-confirmation agenda), le demandeur peut recevoir 2 emails « confirmée ». Pas de garde d'idempotence (ne notifie pas « seulement si transition réelle nouvelle→confirmee »).
- **Correctif** : ne notifier que sur **transition effective** (comparer ancien/nouveau statut avant d'émettre), centraliser la notif dans un seul point.

### [FAIBLE] Envois réels non tracés en base — `lib/email/notifications.ts`
- `notifyNouvelle/Confirmee/Cloturee` et le reply-in-thread n'écrivent aucune ligne d'historique (`intervention_timeline` ou équivalent). L'admin ne peut pas voir « quel email est parti quand » pour ces événements (contrairement aux SMS et au rapport). Correctif : logger chaque envoi dans `intervention_timeline`.

### [FAIBLE] Adresse admin hardcodée — `lib/email/notifications.ts:8`
- `ADMIN_NOTIF_EMAIL = 'info@foxo.be'` en dur. Acceptable (interne) mais à externaliser en paramètre (`parametres`) pour multi-tenant / changement d'adresse.

---

## C. Cycle rapport (post-#68)

Workflow cible : **tech publie (silencieux) → admin consulte ET corrige → admin valide (silencieux) → admin transmet (envoi réel)**. État réel :

- ✅ **Tech publie silencieux** : `publishRapport` (brouillon + statut rapport, aucune notif) — conforme post-#68. Wording UI corrigé.
- ✅ **Valider silencieux** : `validateRapport` (brouillon→valide, aucune notif).
- ✅ **Transmettre = envoi réel** : `resendRapportToSyndic`/assistant `transmettre_rapport`.

### [FORT] « Admin consulte ET corrige » N'EXISTE PAS — `src/app/admin/validation/page.tsx`, `src/app/admin/InterventionsClient.tsx:2545+`
- **Attendu** : l'admin lit les 4 sections + photos et peut corriger avant validation.
- **Réel** :
  - `/admin/validation` n'affiche que **réf / ACP / màj / statut** (l.196-231). Aucune section, aucune photo, aucun bouton d'action — un simple lien vers `/admin?id=`.
  - Le drawer (`InterventionsClient.tsx`, bloc « Rapport au syndic ») affiche le **statut + boutons** (Valider/Envoyer) mais **pas le contenu** (degats/inspection/conclusion/recommandations) ni les photos.
  - `GET /api/admin/rapports/[id]` ne renvoie que `statut/valide_*/transmis_*` — **pas le contenu**.
  - **Aucun chemin d'édition admin** du brouillon : la seule écriture admin est `saveRapportDraftFromAdmin` (sections générées par l'IA, désormais bornée à `brouillon` par #68) — ce n'est pas un éditeur des sections existantes.
- **Ce qu'il faudrait** : (1) étendre `GET /api/admin/rapports/[id]` pour renvoyer `degats, inspection, conclusion, recommandations` + la liste des photos (`photos_interventions`) ; (2) afficher ces 4 sections (lecture) dans `/admin/validation` et/ou le drawer ; (3) un formulaire d'édition admin (textarea par section) appelant une action `updateRapportSections(interventionId, sections)` gardée admin + garde `statut='brouillon'|'valide'` ; (4) après correction, régénérer le PDF (cf. ci-dessous).

### [FORT] PDF transmis ≠ PDF affiché si l'admin a uploadé un PDF manuel — `src/app/api/rapport/[id]/route.ts:19-45` vs `src/lib/rapport/dispatch.ts`
- **Réel** : `/api/rapport/[id]` sert **en priorité le PDF uploadé** dans Storage (`documents/{id}/rapport.pdf`, l.20-36), sinon génère à la volée. Mais `dispatchRapportToSyndic` **régénère toujours** le PDF depuis les sections `rapports` (`buildRapportPdf`), **en ignorant le PDF uploadé**. → Si un admin « corrige » en uploadant un PDF retravaillé, il le voit dans l'aperçu, mais **le syndic reçoit le PDF régénéré depuis la base** (contenu potentiellement différent / obsolète). Incohérence directe de la famille « ce qui est montré ≠ ce qui part ».
- **Bonne nouvelle partielle** : pour le flux normal (sections en base, pas d'upload), `dispatchRapportToSyndic` régénère à l'envoi → le PDF transmis reflète bien les dernières sections. La correction par **édition des sections** (recommandée en C) serait donc correctement reprise ; c'est l'**upload PDF** qui crée le piège.
- **Correctif** : unifier la source de vérité du PDF (soit toujours régénéré depuis les sections — et alors retirer/écarter l'upload manuel de rapport, cf. A), soit faire transmettre le PDF stocké quand il existe.

---

## D. Occupants

### [MOYEN] Réponses occupants invisibles au technicien — `src/app/tech/interventions/[id]/page.tsx:136-180`
- **Attendu** : le tech qui se déplace sait qui a confirmé sa présence.
- **Réel** : le bloc « Occupants » du portail tech affiche **nom + téléphone + boutons SMS/WhatsApp retard**, mais **pas le champ `conf`** (Confirmé / Pas d'accès / En attente). Côté admin, `InterventionsClient.tsx:2227-2230` l'affiche bien. Le tech, destinataire naturel de l'info, ne la voit pas.
- **Correctif** : afficher le badge `conf` dans le bloc occupants tech (réutiliser le mapping admin).

### [MOYEN] `occupant_responses_log` écrit mais jamais lu — `src/app/o/actions.ts:157`, `accept-counter-proposal/route.ts:147`
- **Réel** : deux chemins **insèrent** dans `occupant_responses_log` ; **aucun** ne le **lit** (grep exhaustif). Historique de réponses (audit RGPD/traçabilité présence) accumulé mais exposé nulle part.
- **Correctif** : soit l'exposer (timeline dossier / vue admin), soit acter explicitement que c'est un journal d'audit append-only documenté.

### [FAIBLE] Occupants extraits non matérialisés — `mails_analyses.occupants_extraits` → `confirm-and-create`
- Les occupants détectés par l'IA dans un mail vivent dans `mails_analyses.occupants_extraits` et ne deviennent des lignes `occupants` qu'à la confirmation du dossier. Un mail analysé mais non confirmé garde ses occupants « fantômes ». Cohérent avec le design (rien n'est créé sans confirmation), mais à surveiller : pas de reprise si l'admin crée le dossier par un autre chemin.

---

## E. Portails

### [FAIBLE] Commentaire `vocab.ts` obsolète vs réalité câblée — `src/lib/portal/vocab.ts:16`
- Le type indique `newRequestVerb: string | null;  // null = portail en lecture seule (aucun type ne l'utilise aujourd'hui)`. Or **syndic** (`+ Nouvelle demande`) et **courtier** (`+ Confier une mission`) ont des verbes non-null, et la page `portal/nouveau/NewRequestClient.tsx` câble réellement `submitRequest`. Le commentaire ment sur l'état (vestige d'une phase lecture-seule).
- **Correctif** : corriger le commentaire ; vérifier que le verbe `expert` (souvent lecture seule) est cohérent avec l'affichage du bouton.

### [À VÉRIFIER] Pages portail spécifiques `portal/syndic`, `portal/courtier`, `portal/expert`, `portal/calendar`
- 8 pages portail existent. La cohérence « données affichées vs réelles » de `portal/calendar` et des pages par-rôle n'a pas été tracée en profondeur ici (budget). À auditer : vérifier qu'aucune n'affiche des compteurs/agrégats calculés sur des champs vides post-table-rase.

### [MOYEN] (cross-réf D) Portail tech : l'action « prévenir d'un retard » (SMS/WhatsApp) est proposée pour tout occupant ayant un téléphone, indépendamment de `conf` — un occupant ayant déclaré « pas d'accès » reçoit quand même l'option retard. Cohérence d'action vs état à revoir.

---

## F. Pipeline mails

### [MOYEN] Erreurs avalées silencieusement — `src/app/api/admin/mails/confirm-and-create/route.ts`
- Le chemin de création accumule les erreurs dans un tableau `errors.push(...)` (ex. `update drive_folder_id`, l.299) et **continue** malgré tout, renvoyant un succès partiel. Une création de dossier peut « réussir » avec dossier Drive manquant, liaison mail ratée, etc., sans échec visible. Correctif : remonter un statut partiel explicite à l'UI (warnings) plutôt qu'un `ok` opaque.

### [MOYEN] Observabilité : `agent_logs.intervention_id` reste null pour le cron — `src/lib/cron/check-mails.ts:556` (TODO actif)
- Les appels Claude initiés par `check-mails` ne sont jamais rétro-liés à l'intervention créée (matching fait par le caller APRÈS). Impossible de relier coût/latence IA à un dossier pour ces analyses. Correctif documenté dans le TODO (UPDATE a posteriori ou restructuration).

### [FAIBLE] Risque de doublons de dossiers — `src/lib/intervention-ref.ts` + `matchOrCreateOrganisation`
- `nextRefForYear` gère la course par retry sur `23505`, mais la **détection de doublon métier** (même sinistre, deux mails) repose sur `matchOrCreateOrganisation` + matching d'adresse heuristique. Deux mails du même sinistre via deux chemins (cron auto + confirmation manuelle) peuvent créer deux dossiers. Correctif : clé de déduplication (thread_id ↔ dossier) avant création.

---

## G. UI morte / vestiges

### [FAIBLE] `ponto.ts` — intégration bancaire stub — `src/lib/ponto.ts:35,42` + `src/app/admin/parametres/ParametresClient.tsx:956`
- `connectPonto`/`syncTransactions` sont des TODO non implémentés ; l'UI Paramètres l'annonce honnêtement (« le branchement effectif est dans ponto.ts (TODO)… s'activera automatiquement »). Pas trompeur, mais fonctionnalité annoncée non livrée. Correctif : masquer/désactiver la section tant que non branchée.

### [FAIBLE] TODO valeurs de pricing IA — `src/lib/observability/pricing.ts:10`
- Les tarifs/taux de change de l'observabilité IA sont marqués « à vérifier ». Les coûts affichés peuvent être faux. Correctif : caler sur les tarifs réels.

### [FAIBLE] Alias deprecated facturation — `src/lib/pdf/FacturePdf.tsx:134-136`, `src/app/admin/facturation/actions.ts:122`
- Champs `@deprecated` (totalHt/totalTtc alias, remise_globale_*) conservés pour rétro-compat. Dette à purger.

### [INFO] Alias d'enum UI `en_cours` / `a_relancer` — **sûrs**
- Utilisés comme libellés/filtres UI (`InterventionsClient.tsx:377-378`, `TechnicienDrawer`, `HistoriqueClient`) et **jamais** envoyés à Postgres (aucun `.eq('statut','en_cours')` / `.in(...)` — vérifié). Ils sont résolus côté client vers les vrais statuts. Aucun risque DB. À documenter pour éviter qu'une future requête les envoie tels quels.

---

## H. Données

### [MOYEN] `interventions.drive_folder_id` renseigné uniquement par le pipeline mail — `confirm-and-create/route.ts:297` ; absent ailleurs
- **Réel** : seul `confirm-and-create` écrit `drive_folder_id` (l.297). La création manuelle (`createInterventionFromSlot`) **crée le dossier Drive mais ne persiste pas son id** → `drive_folder_id` reste `null`. Le code aval (`listInterventionDocuments`, `uploadRapport`) **contourne** en résolvant le dossier **par nom** (`resolveInterventionFolderByName`). Ça marche, mais : (a) fragile (renommage d'adresse casse la résolution), (b) un appel Drive supplémentaire à chaque fois, (c) le champ existe mais ment (null alors qu'un dossier existe).
- **Correctif** : persister `drive_folder_id` après `createInterventionFolder` dans tous les chemins de création.

### [FAIBLE] Doc 04 vs schéma : `ref_syndic`/`ref_courtier`/`ref_foxo` n'existent pas en colonnes — `reference_externe` est la vraie colonne
- **Réel** : la colonne DB est `interventions.reference_externe` (écrite par `apply-reanalysis:246`, lue par Dashboard/InterventionsClient). `ref_foxo`/`ref_syndic`/`ref_courtier` n'apparaissent **que** comme clés JSON dans les payloads d'analyse IA (`generate-action.ts:233`, `confirm-and-create:445`, `attachments/analyse`). La doc 04 décrivant des colonnes `ref_syndic/ref_courtier/ref_foxo` est divergente du schéma réel. `vocab.referenceLabel` adapte juste le libellé d'affichage de `reference_externe` selon le rôle. Correctif : aligner la doc 04 sur `reference_externe`.

### [FAIBLE] Colonnes ACP email redondantes — `lib/email/notifications.ts:94`
- `acps` expose `email_facturation, email_rapport, email_factures, email_rapports, email_communications` (singulier ET pluriel). La cascade `getEmailForDoc` doit jongler avec les deux familles. Risque d'email envoyé à la mauvaise variante. Correctif : converger vers un seul jeu de colonnes.

---

## Tableau récapitulatif (impact décroissant)

| # | Impact | Constat | Localisation |
|---|--------|---------|--------------|
| 1 | **FORT** | `interventions.statut` reste `rapport` après validation/transmission (jamais → cloturee) ; divergence durable avec `rapports.statut` | `tech/actions.ts:140`, `admin/actions.ts:331`, `resendRapportToSyndic` |
| 2 | **FORT** | « Admin consulte ET corrige le rapport » inexistant : ni affichage des 4 sections/photos, ni édition, dans /admin/validation et le drawer | `admin/validation/page.tsx`, `InterventionsClient.tsx:2545+`, `api/admin/rapports/[id]` |
| 3 | **FORT** | PDF transmis (régénéré depuis la base) ≠ PDF uploadé/affiché → le syndic peut recevoir un autre contenu que celui vu par l'admin | `api/rapport/[id]/route.ts:19-45` vs `lib/rapport/dispatch.ts` |
| 4 | **MOYEN** | Upload PDF rapport admin ne crée pas de ligne `rapports` → absent de la file de validation, non validable/transmissible | `admin/actions.ts:142-173` |
| 5 | **MOYEN** | Réponses de présence des occupants invisibles côté technicien | `tech/interventions/[id]/page.tsx:136-180` |
| 6 | **MOYEN** | `occupant_responses_log` écrit mais jamais lu | `o/actions.ts:157`, `accept-counter-proposal:147` |
| 7 | **MOYEN** | Double notification `confirmee` possible (plusieurs chemins, pas de garde de transition) | `planning/actions.ts:447`, `confirm-mail`, `accept-counter-proposal` |
| 8 | **MOYEN** | `drive_folder_id` non persisté hors pipeline mail (création manuelle → null, résolution par nom fragile) | `planning/actions.ts` (création) vs `confirm-and-create:297` |
| 9 | **MOYEN** | Pipeline mail : erreurs avalées (succès partiel opaque) | `confirm-and-create/route.ts` |
| 10 | **MOYEN** | Observabilité : `agent_logs.intervention_id` null pour le cron mail | `check-mails.ts:556` |
| 11 | FAIBLE | Envois email non tracés en base (nouvelle/confirmee/cloturee, reply-in-thread) | `lib/email/notifications.ts` |
| 12 | FAIBLE | `realisee` sans relance/alerte si pas de rapport | `tech/actions.ts:74` |
| 13 | FAIBLE | Commentaire `vocab.ts` « lecture seule » obsolète (new request câblé) | `lib/portal/vocab.ts:16` |
| 14 | FAIBLE | Doc 04 : `ref_syndic/ref_courtier/ref_foxo` ≠ colonne réelle `reference_externe` | `apply-reanalysis:246` |
| 15 | FAIBLE | Occupants extraits non matérialisés si non confirmés | `mails_analyses` → `confirm-and-create` |
| 16 | FAIBLE | Stubs/TODO : `ponto.ts`, `pricing.ts`, alias deprecated facturation | `lib/ponto.ts`, `pricing.ts:10`, `FacturePdf.tsx:134` |
| 17 | FAIBLE | Colonnes ACP email singulier/pluriel redondantes | `notifications.ts:94` |
| 18 | INFO | Alias UI `en_cours`/`a_relancer` jamais envoyés à Postgres (sûrs) | `InterventionsClient.tsx:377-378` |

---

## Top 10 corrections par valeur métier

1. **Afficher le contenu du rapport (4 sections + photos) à l'admin** dans `/admin/validation` et/ou le drawer (#2) — sans ça, « valider » est un acte aveugle. *Valeur : confiance dans la transmission au syndic.*
2. **Unifier la source du PDF transmis** (#3) — garantir que le syndic reçoit exactement ce que l'admin a relu. Régénération depuis les sections + retrait/écartement de l'upload PDF manuel.
3. **Faire avancer le dossier après transmission** (#1) — `rapport`→`cloturee` (ou statut « transmis ») à l'envoi, pour vider le pipeline des dossiers déjà traités.
4. **Ajouter l'édition admin des sections du rapport** (#2) — `updateRapportSections` gardée + garde de statut, suivie d'une régénération PDF. Complète « consulter ET corriger ».
5. **Réintégrer l'upload PDF rapport dans le cycle `rapports`** (#4) — ou le supprimer si redondant avec le flux tech/IA.
6. **Montrer la présence des occupants au technicien** (#5) — info opérationnelle directe pour le déplacement terrain.
7. **Dé-dupliquer / garder les notifications `confirmee`** (#7) — notifier uniquement sur transition réelle ; éviter le double email au syndic.
8. **Persister `drive_folder_id` partout** (#8) — fiabiliser la résolution Drive et la cohérence du champ.
9. **Tracer les envois email en `intervention_timeline`** (#11) + exposer `occupant_responses_log` (#6) — visibilité et auditabilité des communications.
10. **Remonter les échecs partiels du pipeline mail** (#9) + rétro-lier l'observabilité (#10) — fiabilité et diagnostic de l'ingestion automatique.

---

## E-bis — Passage dédié : portails par rôle (`src/app/portal/**`)

**Architecture observée** : « Stratégie A — portail unique auto-adaptatif ». Les routes `/portal/syndic`, `/portal/courtier`, `/portal/expert` sont de **simples redirections** vers `/portal` (aucune logique ni donnée), et `/portal/page.tsx` adapte l'affichage selon `org.type` via `vocabFor(orgType)`. C'est propre : pas de duplication de code, et ces alias ne peuvent pas « casser » post-table-rase (constat positif).

### [FORT] Un courtier (ou expert) lié via `dossiers_sinistres` ne voit AUCUN dossier dans son portail — `src/app/portal/interventions/page.tsx:29`, `src/app/portal/page.tsx:40`, `src/app/portal/interventions/[id]/page.tsx:39`
- **Attendu** : un courtier voit dans son portail les dossiers sinistres où il est mandaté. La RLS le permet déjà : policy `courtier_select_via_dossier` (`2026-05-11c_rls_core_tables.sql:152`, `USING (org_in_dossier(id, current_org_id()))`), et `checkRapportAccess` gère explicitement la voie courtier-via-dossier (le courtier peut télécharger le PDF du rapport).
- **Réel** : les **trois** requêtes du portail (dashboard, liste, détail) filtrent **uniquement** par `.or(syndic_id.eq.${org.id},organisation_id.eq.${org.id})`. Le `dossiers_sinistres` n'est utilisé qu'en **enrichissement secondaire** (`interventions/page.tsx:48`, `.in('intervention_id', ivIds)` sur des interventions déjà récupérées) pour afficher `assure`/`ref_courtier` — il **n'ajoute aucune intervention** à la liste. Conséquence : une intervention rattachée à un courtier **seulement** via `dossiers_sinistres.courtier_id` (cas d'un courtier ajouté par l'admin à un dossier d'un syndic) est **invisible** dans la liste ET provoque un `redirect('/portal/interventions')` à l'ouverture du détail (`[id]/page.tsx:43`). Le rôle courtier — l'un des 3 rôles du portail — est donc partiellement non fonctionnel.
- **Nuance** : les dossiers **créés par le courtier lui-même** via `/portal/nouveau` restent visibles, car `submitRequest` pose `syndic_id = org.id` (le `.or` les retrouve). Le trou concerne les dossiers où le courtier est tiers (mandaté sur le sinistre d'un syndic).
- **Correctif** : étendre les 3 requêtes pour inclure les interventions liées via `dossiers_sinistres` pour les orgs `courtier`/`expert` — soit récupérer d'abord les `intervention_id` de `dossiers_sinistres` où `courtier_id = org.id` et les ajouter au filtre (`.or(...,id.in.(...))`), soit s'appuyer sur la RLS en retirant le filtre applicatif redondant (laisser la policy scoper). La garde du détail doit accepter la même voie (sinon : visible en liste mais redirigé à l'ouverture).

### [MOYEN] Vocabulaire incohérent desktop vs mobile — `src/app/portal/PortalNav.tsx:164-177`
- **Attendu** (doc 02, architecture universelle) : zéro libellé métier hardcodé ; tout passe par `vocab.ts`.
- **Réel** : la nav **desktop** (`NAV`, l.164-166) utilise `vocab.interventionsCap` (✔ → un courtier voit « Dossiers sinistres »), mais la **bottom-nav mobile** (`BOTTOM_NAV`, l.173-177) **hardcode** `label: 'Accueil'` et `label: 'Interventions'`. Un courtier/expert sur mobile voit donc « Interventions » alors que tout le reste de son portail dit « dossiers sinistres ». Incohérence visible et contraire à la règle vocab.
- **Correctif** : remplacer par `vocab.interventionsCap` (et un libellé d'accueil neutre) dans `BOTTOM_NAV`.

### [FAIBLE] Libellés métier hardcodés dans le dashboard malgré `vocab.ts` — `src/app/portal/page.tsx:197,206`
- `« Carte des interventions »` (l.197) est hardcodé alors que `vocab.interventions` existe (devrait être « Carte des dossiers » pour courtier/expert). Le titre « récentes » (l.206) bricole l'accord avec `orgType === 'syndic' ? 'es' : 's'` au lieu d'un libellé vocab. Les StatCards (« En cours », « En attente », « Rapports dispo. », « Clôturées ») et « Prochaines disponibilités FoxO » sont génériques — acceptables. Correctif : router les libellés liés aux « interventions/dossiers » via `vocab`.

### [FAIBLE] Calendar expose les créneaux `reserve` aux partenaires — `src/app/portal/calendar/page.tsx` (slots `reserve`)
- Le calendrier (rôle-agnostique, montre la dispo FoxO) affiche les créneaux `reserve` (heure + ✗). Pas de PII (aucun détail client), mais un partenaire voit la charge de FoxO (quand d'autres clients ont réservé). Acceptable ; à acter consciemment. Le calendrier est correctement vide-safe (mois sans créneau → grille vide, pas de crash).

### [FAIBLE — positif] États vides et agrégats post-table-rase — `src/app/portal/page.tsx:21-33,92-99,207,264`
- **Vérifié OK** : `org` null → carte « Compte non lié » explicite ; stats calculées côté serveur sur les interventions réellement rattachées (zéro si aucune) → les StatCards affichent `0`, pas de valeur fausse ; listes « récentes » et « dispos » ont des états vides gérés ; la carte ne s'affiche que si `pins.length > 0`. **Aucun agrégat trompeur ni page cassée** quand la base est vide. (Le seul écart de complétude est le trou courtier-via-dossier ci-dessus, qui *sous-affiche* — il ne montre pas de faux, il cache du réel.)

### Actions disponibles — câblage
- `+ Nouvelle demande` / `+ Confier une mission` : rendu si `vocab.newRequestVerb` non-null (les 3 rôles l'ont) → `/portal/nouveau` → `NewRequestClient` → `submitRequest` (gardé `getCurrentSyndic`, scope `org.id`). **Câblé et fonctionnel.** Rappel (constat E #13) : le commentaire de `vocab.ts:16` « null = aucun type ne l'utilise aujourd'hui » est faux (vestige).

---

## Addendum au tableau récapitulatif (E-bis)

| # | Impact | Constat | Localisation |
|---|--------|---------|--------------|
| 19 | **FORT** | Courtier/expert lié via `dossiers_sinistres` invisible dans le portail (liste + détail filtrent `.or(syndic_id,organisation_id)`, RLS l'autorise pourtant) | `portal/interventions/page.tsx:29`, `portal/page.tsx:40`, `portal/interventions/[id]/page.tsx:39` |
| 20 | MOYEN | Vocab incohérent : bottom-nav mobile hardcode « Accueil »/« Interventions » vs desktop `vocab.interventionsCap` | `portal/PortalNav.tsx:173-177` |
| 21 | FAIBLE | Libellés hardcodés dans le dashboard portail (« Carte des interventions », accord « récentes ») malgré `vocab.ts` | `portal/page.tsx:197,206` |
| 22 | FAIBLE | Calendar expose les créneaux `reserve` (charge FoxO) aux partenaires | `portal/calendar/page.tsx` |

*(Constats positifs E-bis : alias `/portal/{syndic,courtier,expert}` = redirections propres ; états vides et agrégats du dashboard corrects post-table-rase — pas de faux chiffre ni de page cassée.)*

---

## Top 10 corrections par valeur métier (révisé post E-bis)

1. **Rendre visibles aux courtiers/experts leurs dossiers liés via `dossiers_sinistres`** (#19) — un rôle entier du portail est aujourd'hui aveugle aux dossiers où il est mandaté par un tiers, alors que la RLS et le téléchargement de rapport l'autorisent déjà. *Valeur : le portail courtier/expert fonctionne vraiment.*
2. **Afficher le contenu du rapport (4 sections + photos) à l'admin** avant validation (#2) — « valider » à l'aveugle sinon.
3. **Unifier la source du PDF transmis** (#3) — garantir que le syndic reçoit ce que l'admin a relu.
4. **Faire avancer le dossier après transmission** (#1) — `rapport`→`cloturee`, vider le pipeline des dossiers traités.
5. **Édition admin des sections du rapport** (#2) + régénération PDF — compléter « consulter ET corriger ».
6. **Réintégrer l'upload PDF rapport dans le cycle `rapports`** (#4) — ou le supprimer si redondant.
7. **Montrer la présence des occupants au technicien** (#5) — info terrain directe.
8. **Corriger le vocabulaire mobile + dashboard portail** (#20, #21) — cohérence « dossiers sinistres » sur tous les écrans courtier/expert.
9. **Dé-dupliquer les notifications `confirmee`** (#7) + **tracer les envois email** (#11) + exposer `occupant_responses_log` (#6).
10. **Persister `drive_folder_id` partout** (#8) + **remonter les échecs partiels du pipeline mail** (#9) + rétro-lier l'observabilité (#10).

---
*Audit de cohérence réalisé en lecture seule le 2026-06-10 sur HEAD `9e15b6c` (post-#68), passage portails par rôle ajouté le même jour. Tâche 0 (migration cleanup observations_terrain) committée sur main ; aucun autre fichier applicatif modifié.*
