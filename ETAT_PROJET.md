## SNAPSHOT 2026-06-14 (suite 4) — Ménage base : doublon 2026-000 purgé + table orpheline public.timeline supprimée (SQL direct, pas de PR)

ÉTAT GIT : aucun changement code (main = 7686658 + snapshots doc). Opération SQL directe en Supabase. Sauvegarde JSON manuelle prise AVANT (intervention purgée + ses enfants + public.timeline complète, conservée côté Foxo).

CONTEXTE : 2 lignes partageaient ref='2026-000' — Ligne 1 (330adf15…, confirmee, déjà à la corbeille depuis le 11/06) et Ligne 2 (d03d27f0…, cloturee, vivante = bac à sable E2E). public.timeline = vestige (FK intervention_id CASCADE) remplacé par intervention_timeline, référencé nulle part dans le code.

EXÉCUTÉ (transaction begin/commit, SQL Supabase) :
1. drop table if exists public.timeline.
2. Créneau de la Ligne 1 libéré (FK NO ACTION → sinon blocage) ; sms_logs Ligne 1 supprimés (défensif).
3. delete interventions Ligne 1 → CASCADE a effacé ses 5 photos + 1 rapport + timeline.
4. Ligne 2 CONSERVÉE.
VÉRIFIÉ : ligne1=0, ligne2=1, total ref 2026-000=1, public.timeline=null. Conforme.

PIÈGE : la route DELETE /api/admin/interventions/[id] refuse les statuts confirmee/cloturee → ménage fait en SQL direct (même cascade manuelle reproduite : libérer créneau + sms_logs avant delete). FK vers interventions : majorité CASCADE ; NO ACTION sur creneaux_disponibles / factures / sms_logs.

LOT « FINITIONS RAPIDES » = TERMINÉ : autocomplete syndic (classé, déjà satisfait), Phase 4 mails (PR #100), géocodage ACP (PR #102), ménage 2026-000 + public.timeline (ce snapshot).

BACKLOG : src/app/api/admin/interventions/search/route.ts filtre deleted_at manquant (à traiter avec « page Interventions dédiée ») ; cohérences (double notif confirmee, occupant_responses_log jamais relu, drive_folder_id non persisté) ; audit qualité #3 ; Observabilité IA (runAgent + agent_logs) ; Ops rallumage crons mails = TOUTE DERNIÈRE étape.

## SNAPSHOT 2026-06-14 (suite 3) — Géocodage des ACP créées à la main CLOSE (PR #102)

ÉTAT GIT : main = 7686658 (merge PR #102, merge commit, 2 commits préservés, branche fix/acp-geocodage supprimée). 2 commits : e749638 (géocodage createAcp / création à froid) → 8608de0 (géocodage route POST /api/admin/acps / création rapide depuis le drawer syndic).

OBJECTIF : une ACP créée à la main n'apparaissait pas sur la carte admin (src/app/admin/page.tsx — pas de pin si acps.lat/lng absents) quand l'adresse n'était pas choisie via l'autocomplete → coordonnées NULL.

DIAGNOSTIC (audit lecture seule, clone aligné sur prod) :
- Helper geocodeAddress(adresse) (src/lib/geo/geocode.ts) EXISTE DÉJÀ : Nominatim/OpenStreetMap, bornage Belgique (countrycodes=be + viewbox + bounded), User-Agent FoxO, best-effort (try/catch → null, jamais d'exception). Aucune dépendance npm.
- Il n'était importé QUE dans planning/actions.ts (proposeSlotForIntervention, scoring de créneau — PAS pour persister des coordonnées d'ACP).
- Deux chemins de création d'ACP (table acps, celle que lit la carte) sans géocodage : createAcp (src/app/admin/interventions/actions.ts, « + nouvelle ACP » du modal à froid) ne posait AUCUNE coordonnée ; route POST /api/admin/acps (création rapide drawer syndic) gardait les coordonnées reçues mais ne géocodait pas en secours.

LIVRÉ (tout en prod via PR #102, 2 fichiers, +33/-0, 0 SQL) :
- src/app/admin/interventions/actions.ts : import geocodeAddress ; dans createAcp, AVANT l'insert, géocodage best-effort à partir de [input.adresse, input.code_postal, input.ville] → pose base.lat/lng si Nominatim répond. Le retry 42703 (colonne syndic_id absente) conserve lat/lng (présents dans ...safe).
- src/app/api/admin/acps/route.ts : import geocodeAddress ; AVANT l'insert, si payload.lat == null || payload.lng == null, géocodage à partir de [payload.adresse, payload.code_postal, payload.ville] → pose payload.lat/lng si réponse. Les coordonnées de l'autocomplete (cas nominal) restent prioritaires (géocodage seulement si absentes).

DÉCISIONS / PIÈGES :
- Comportement best-effort STRICTEMENT additif : échec de géocodage ou adresse vide → lat/lng restent absents/null, exactement comme avant (pas de pin, pas d'erreur). Aucune régression.
- Latence : un appel Nominatim (~300-800 ms) ajouté aux créations manuelles d'ACP (rares) — acceptable. Politique Nominatim 1 req/s respectée.
- Table clients (facturation, type='acp') DISTINCTE de acps : NON géocodée, hors scope — la carte lit acps. Consolidation acps/clients = sujet séparé connu.

INVARIANTS INCHANGÉS : crons mails toujours FERMÉS (NE PAS rallumer). tsc --noEmit vert + hook pre-push OK. Merge commit (jamais squash), branche supprimée. Aucune migration.

VALIDATION : diff relu indépendamment (clone + git diff origin/main...branche), conforme. tsc vert à chaque commit. Pas de test E2E artificiel — vérification en usage réel (créer une ACP à la main → pin sur la carte).

BACKLOG (non bloquant) :
- [RECOLLÉ — perdu lors du rebuild doc 000632f, identifié au snapshot PR #101] src/app/api/admin/interventions/search/route.ts a le MÊME oubli de filtre .is('deleted_at', null) que la page Alertes (corrigée en PR #101) → une recherche peut faire remonter des dossiers soft-deletés. À traiter avec le chantier « page Interventions dédiée ».
- Ménage doublons réf 2026-000 + ancienne table orpheline public.timeline (DESTRUCTIF → export JSON manuel AVANT, Supabase Free sans backup auto). PROCHAINE finition prévue.
- Cohérences : double notif confirmee, occupant_responses_log jamais relu, drive_folder_id non persisté ; audit qualité #3 ; Observabilité IA (runAgent + agent_logs).
- Produit séparé (pas un bug) : badge « Mails » restreint aux seules demandes d'intervention.
- Ops : rallumer les crons mails = TOUTE DERNIÈRE étape, précédée du marquage « lu » des mails déjà traités.

## SNAPSHOT 2026-06-14 (PR #101) — Alertes : exclure les interventions soft-deletées (mergée HORS session)

ÉTAT GIT : main = cee3ef0 (merge PR #101, merge commit, branche fix/alertes-exclure-corbeille). 1 commit : ff03824.

NOTE : PR mergée INDÉPENDAMMENT de la conversation en cours (découverte au moment du commit doc des finitions Phase 4) — documentée ici pour garder le log complet, PAS réalisée dans cette session.

LIVRÉ (1 fichier, +1, 0 SQL) : src/app/admin/alertes/page.tsx — ajout de .is('deleted_at', null) à la requête interventions de la page Alertes, AVANT le filtre .or(statut en_suspens/nouvelle/rapport). Effet : les interventions soft-deletées ne remontent plus dans les alertes admin. Même famille que les fix soft-delete récents (badge validation, PR #98).

INVARIANTS : crons mails fermés. tsc + hook pre-push OK (PR mergée).

## SNAPSHOT 2026-06-14 (suite 2) — Finitions Phase 4 mails CLOSE (PR #100) + Ops Netlify débranché + finition « autocomplete syndic » classée

ÉTAT GIT : main = 2c8f23f (merge PR #100, merge commit, 2 commits préservés, branche fix/phase4-mails-finitions supprimée). 2 commits : 0fc2819 (matching réponse occupant sur le dernier message entrant) → 5881dc1 (refetch panneau réponse occupant au changement de dossier lié). [PR #101 alertes mergée ensuite → voir snapshot ci-dessus.]

OBJECTIF : deux finitions « Phase 4 mails » non bloquantes, regroupées en 1 PR.

DIAGNOSTIC (audit lecture seule : clone du repo + relecture diff) :
- Correctif A — auto-confirmation réponse occupant (src/app/api/admin/mails/analyse-deep/route.ts) : l'appel matchOccupantResponse recevait expediteur: messages[0]?.from. Les messages d'un thread Gmail (getEmailThread, threads.get?format=full) sont en ordre chronologique CROISSANT → messages[0] = le plus ancien = NOTRE demande de confirmation sortante (info@foxo.be), jamais la réponse de l'occupant. Le niveau 'sur' s'obtient quand email expéditeur == email d'un occupant unique → comparé à notre propre adresse, il ne pouvait JAMAIS se déclencher : l'auto-confirmation par email était de facto MORTE.
- Correctif B — panneau OccupantResponsePanel (src/app/admin/mails/FicheDossierCard.tsx) : monté avec key={analyse.thread_id}, donc refetch uniquement au changement de MAIL. Re-relier un mail à une AUTRE intervention (sans changer de mail) ne changeait pas thread_id → key identique → match périmé (occupants de l'ancien dossier).

LIVRÉ (tout en prod via PR #100, 2 fichiers, +23/-3, 0 SQL) :
- analyse-deep/route.ts : import parseSenderEmail ajouté ; nouvelle fonction module lastIncomingFrom(msgs) → renvoie le `from` du DERNIER message entrant (parcours depuis la fin, saute les expéditeurs @foxo.be / .foxo.be, fallback prudent sur le dernier message) ; expediteur du matcher passé de messages[0]?.from à lastIncomingFrom(messages). La ligne IDENTIQUE messages[0]?.from des métadonnées d'affichage (sujet/expediteur/recu_le, ~l.709) LAISSÉE INTACTE volontairement.
- FicheDossierCard.tsx : key du <OccupantResponsePanel> passée de analyse.thread_id à `${analyse.thread_id}:${analyse.dossier_match_id ?? 'none'}`.

CHANGEMENT DE COMPORTEMENT ASSUMÉ (correctif A) : l'auto-confirmation par email (badge « confirmé automatiquement — email vérifié », confirmOccupantFromMail source 'mail_auto') peut désormais réellement se déclencher quand un occupant répond depuis son email exact et unique sur le dossier. Le matcher reste prudent : tout autre niveau (probable/ambigu/refus_contre) part en validation manuelle. Aucune confirmation silencieuse hors niveau 'sur'.

PIÈGE TRAITÉ : la ligne expediteur: messages[0]?.from apparaît DEUX FOIS dans analyse-deep (l.709 métadonnées = à garder ; l.764 input matcher = à corriger), texte identique à l'indentation près → remplacement ancré sur le bloc multi-lignes (occupantCible/occupants) pour ne toucher que le bon.

INVARIANTS INCHANGÉS : crons mails toujours FERMÉS (NE PAS rallumer). Préversion = base/Drive/Gmail de PROD. tsc --noEmit vert + hook pre-push OK. Merge commit (jamais squash), branche supprimée.

VALIDATION : diff relu indépendamment (clone + git diff origin/main...branche), conforme. tsc vert à chaque commit. Pas de test E2E préversion — décision assumée : éviter une mutation prod pour 2 correctifs ciblés déjà vérifiés par diff + tsc.

── OPS & FINITIONS NON-CODE de cette session ──
- Chantier #5 « Débrancher les checks Netlify parasites » FAIT (aucun code, aucune PR). Audit via connecteur Netlify : 2 sites sur le compte (foxo-track, foxo-rdv) = mini-pages déployées À LA MAIN (track.html / r.html / index.html), AUCUN lien Git, sans rapport avec foxo-app. Les 4 checks rouges (Deploy Preview + Header/Redirect/Pages rules) étaient posés via l'AUTORISATION OAuth Netlify sur le compte GitHub foxotech1-netizen (Netlify ABSENT de « Installed GitHub Apps » → connexion OAuth historique, pas GitHub App). CORRECTION : OAuth Netlify révoqué (GitHub → Settings → Applications → Authorized OAuth Apps → Netlify → Revoke). Effet : plus aucun check Netlify sur les futures PR. Réversible. Sites foxo-track/foxo-rdv et prod Vercel non affectés (Vercel reste dans Installed GitHub Apps).
- Finition « autocomplete syndic sur toutes les organisations » CLASSÉE (déjà satisfaite, aucun code). Les DEUX modals de création (Planning CreateInterventionModal + création à froid ColdInterventionModal) appellent déjà searchOrganisations(q) SANS filtre → cherchent déjà dans TOUTES les organisations. Seul appel filtré (InterventionsClient l.4146, { types: ['courtier','expert'] }) = mandater courtier/expert = VOULU. Seule restriction type=syndic restante = « Syndic gestionnaire » d'une ACP (ClientForm, /api/admin/organisations?type=syndic) = correct métier. Création d'ACP à la volée (ColdInterventionModal) fixe syndic_id = syndic demandeur (défaut sain). Foxo confirme aucun blocage concret → rien à corriger.

BACKLOG (non bloquant) :
- Géocodage des ACP créées à la main (lat/lng) — PROCHAINE finition prévue.
- Ménage doublons réf 2026-000 + ancienne table orpheline public.timeline (DESTRUCTIF → export JSON manuel d'abord, Supabase Free sans backup auto).
- Cohérences : double notif confirmee, occupant_responses_log jamais relu, drive_folder_id non persisté ; audit qualité #3 ; Observabilité IA (runAgent + agent_logs).
- Produit séparé (pas un bug) : badge « Mails » restreint aux seules demandes d'intervention.
- Ops : rallumer les crons mails = TOUTE DERNIÈRE étape, précédée du marquage « lu » des mails déjà traités.

## SNAPSHOT 2026-06-14 (suite) — Chantier « Type d'occupant au formulaire de création » CLOSE (PR #99)

ÉTAT GIT : main = 6d945a6 (merge PR #99, merge commit, 2 commits préservés, branche feat/occupant-type-creation supprimée). 2 commits : 4ead22e (feat : type d'occupant au formulaire) → 61909cd (docs : commentaire createInterventionCold à jour).

OBJECTIF : permettre de renseigner le TYPE d'occupant (locataire/propriétaire/concierge/…) au formulaire de création d'intervention (création à froid + modal Planning), via le composant partagé OccupantsEditor.

DIAGNOSTIC (audit lecture seule) : le vocabulaire TypeOccupant (8 valeurs : occupant, proprietaire, locataire, concierge, voisin, gestionnaire, parties_communes, autre), les labels FR (TYPE_OCCUPANT_LABEL, src/lib/types/database.ts) et un <select> réutilisable (drawer d'édition d'InterventionsClient) EXISTAIENT DÉJÀ. La contrainte SQL occupants_type_occupant_check accepte déjà les 8 valeurs (étendue le 2026-05-29) → AUCUNE migration. Avant ce chantier : la création à froid forçait type_occupant='occupant' ; le Planning ne posait PAS type_occupant (NULL). CronOccupantType (type de OccupantInsertRow.type_occupant) est identique à TypeOccupant → affectation type-safe.

LIVRÉ (tout en prod via PR #99, 3 fichiers, +20/-2, 0 SQL) :
- src/app/admin/interventions/OccupantsEditor.tsx (composant PARTAGÉ Planning + création à froid) : import TYPE_OCCUPANT_LABEL/TypeOccupant ; emptyOccupant() initialise type_occupant:'occupant' ; nouveau <select> « Type d'occupant » (Object.entries(TYPE_OCCUPANT_LABEL)) inséré entre la grille Appartement/Étage et la grille Prénom. Apparaît AUTOMATIQUEMENT dans les deux modals.
- src/app/admin/planning/actions.ts : TypeOccupant ajouté à l'import database ; SlotOccupant gagne type_occupant?:TypeOccupant ; createInterventionFromSlot persiste type_occupant: o.type_occupant ?? 'occupant'.
- src/app/admin/interventions/actions.ts : createInterventionCold passe de type_occupant:'occupant' figé à o.type_occupant ?? 'occupant' (+ commentaire §6 mis à jour, 61909cd).

DÉCISIONS / PIÈGES :
- Effet de bord ASSUMÉ : les occupants créés via le Planning ont désormais un type (défaut 'occupant' au lieu de NULL). Amélioration — le rapport PDF (dispatch.ts / report-data-mapping.ts) affiche déjà ce type.
- Pas besoin de toucher les modals parents (CreateInterventionModal, ColdInterventionModal) : les fallbacks ?? 'occupant' (éditeur + inserts) couvrent un type_occupant absent de l'état initial parent.
- emptyOccupant() est interne (non exporté), utilisé seulement par addOccupant.

INVARIANTS INCHANGÉS : crons mails toujours fermés. Préversion = base/Drive/Gmail de PROD. tsc --noEmit vert + hook pre-push OK.

VALIDÉ E2E préversion : sélecteur « Type d'occupant » présent à la création, valeur non-défaut (ex. Locataire) enregistrée et ré-affichée sur le dossier.

BACKLOG (non bloquant) :
- Finitions antérieures encore ouvertes : autocomplete « syndic » sur toutes les organisations ; géocodage des ACP créées à la main (lat/lng).
- Produit séparé (pas un bug) : badge « Mails » restreint aux seules demandes d'intervention.

## SNAPSHOT 2026-06-14 — Chantier « Pastilles sidebar incorrectes » CLOSE (PR #98)

ÉTAT GIT : main = 0ee286c (merge PR #98, merge commit, 3 commits préservés, branche claude/validation-badge-orphan-reports-wmf1oq supprimée). 3 commits : 95bfa8a (badge À valider exclut les rapports d'interventions supprimées) → 5dd2c59 (compter les rapports vivants, pas les interventions) → 227648d (badge Mails = comptage exact au lieu de resultSizeEstimate).

OBJECTIF : corriger deux pastilles du sidebar admin affichant des nombres faux — « Mails » = 201 (réel ~14) et « À valider » = 1 (réel 0).

DIAGNOSTIC (audit lecture seule + SQL de décomposition) :
- Badge « Mails » (countUnreadMails, src/lib/gmail.ts) : renvoyait resultSizeEstimate de l'API Gmail (requête in:inbox is:unread + exclusion send.foxo.be) — une ESTIMATION non fiable (201 affiché pour ~14 messages réels). Bug de code.
- Badge « À valider » (getValidationTotal, src/lib/admin/validation-queue.ts ; alimente le badge sidebar ET la pastille hub) : SQL des 5 sources → le « 1 » venait UNIQUEMENT des rapports. Rapport identifié = intervention 2026-000, soft-deletée le 11/06, rapport resté 'brouillon'. Le compteur comptait les rapports brouillon/validé SANS filtrer l'intervention parente supprimée, alors que la page /admin/validation les excluait déjà → divergence badge vs page. (Le dashboard compte, lui, les interventions de statut 'rapport' = 0 : mesure encore différente, non touchée.)

LIVRÉ (tout en prod via PR #98, 2 fichiers seulement) :
- src/lib/gmail.ts : countUnreadMails remplacée par un comptage EXACT via pagination de messages.list (maxResults 100, addition des messages renvoyés, garde-fou 5 pages x 100 = 500 max ; au-delà le badge plafonne). Signature et constantes inchangées (getValidAccessToken, API, EXCLUDE_PLATFORM_MAILS_Q).
- src/lib/admin/validation-queue.ts : applyRapportsAValider SUPPRIMÉ (utilisé seulement par getValidationTotal) → getRapportsAValiderCount(supabase), réplique exacte de la logique de listing de /admin/validation : Set des intervention_id vivantes (deleted_at null) puis filtrage du tableau d'ids (1 entrée par rapport) → compte les LIGNES de rapports vivants (gère une intervention à plusieurs rapports). getValidationTotal recâblé dessus.

DÉCISIONS / PIÈGES :
- Le badge « Mails » compte les MESSAGES non lus (pas les conversations Gmail) → cohérent avec la page Mails de FoxO (les deux à 14). L'écart avec un décompte « conversations » côté Gmail web (~7) est normal : un fil à plusieurs messages non lus compte pour plusieurs.
- Table rapports : clé sur intervention_id, PAS de colonne id (un SELECT r.id échoue en 42703), PAS de colonne deleted_at → on filtre le soft-delete via l'intervention parente. Pas de FK fiable rapports→interventions pour un embed PostgREST → approche 2 requêtes (identique à la page).
- AUCUNE migration SQL, AUCUNE suppression de données : le rapport orphelin de 2026-000 reste en base, il ne compte plus.
- Branche découverte non poussée : une session Claude Code reprise (« Session reprise ») avait déjà écrit ce fix validation en local (95bfa8a + correction 5dd2c59) sans jamais le pousser → invisible sur GitHub et dans le récap. L'audit-first (Claude Code a signalé le doublon) a évité de réintroduire le sous-comptage corrigé par 5dd2c59. Leçon : pousser tôt ; « conteneur éphémère » n'est pas absolu, une session peut reprendre avec son état local.

INVARIANTS INCHANGÉS : crons mails toujours fermés. Préversion = base/Drive/Gmail de PROD. tsc --noEmit vert + hook pre-push OK.

VALIDÉ E2E préversion : sidebar Mails 201 → 14 (= « 14 non lus » de la page Mails) ; badge « À valider » → 0 (plus de pastille).

BACKLOG (non bloquant) :
- Si souhaité : badge « Mails » restreint aux seules demandes d'intervention (exclure les mails fournisseurs type Coolblue) — chantier produit séparé, pas un bug.
- Reliquats antérieurs : occupant « type » dans le formulaire de création ; autocomplete « syndic » sur toutes les organisations ; géocodage des ACP créées à la main (lat/lng).

## SNAPSHOT 2026-06-13 (soir) — Chantier « Page Interventions admin + création à froid » CLOSE (PR #96)

ÉTAT GIT : main = 9af392c (merge PR #96, merge commit, 8 commits préservés, branche feat/admin-interventions-page auto-supprimée). 8 commits : 0800eb0 (page liste listOnly + sidebar) → 039a7f3 (createInterventionCold) → 9fb864d (formulaire + bouton) → d23fad8 (champ adresse syndic, remplacé ensuite) → 1bf324c (extraction OccupantsEditor) → 1a8c59a (createAcp à la volée) → e3fd6b1 (occupants partagés + adresse syndic structurée) → 7f875a0 (fix type obligatoire NOT NULL).

OBJECTIF : page admin listant TOUTES les interventions + création « à froid » (sans planning, sans Agenda, sans notification), pour le ré-encodage de l'historique.

LIVRÉ (tout en prod via PR #96) :
- Page /admin/interventions (src/app/admin/interventions/page.tsx) : réutilise InterventionsClient via un NOUVEAU prop listOnly (masque titre + widgets dashboard ; conserve liste + filtres). listOnly défaut false → /admin (dashboard) STRICTEMENT inchangé. Entrée sidebar « Interventions » (ClipboardList) dans NAV_MAIN. Garde admin héritée du layout.
- Action createInterventionCold (src/app/admin/interventions/actions.ts) : garde admin, statut au choix VALIDÉ (défaut nouvelle), TYPE OBLIGATOIRE (garde-fou serveur : interventions.type est NOT NULL en base, le type TS string|null est faux), source 'admin', creneau_debut/technicien_id optionnels, drive_folder_id null, pas de géocodage. Réf = input.ref || nextRefForYear() + retry 23505 (réf auto → régénère ; réf fournie → erreur). Occupants via safeInsertOccupants (best-effort, conf 'en_attente', type_occupant 'occupant'). Payloads syndic/particulier = miroir de createInterventionFromSlot MAIS statut libre + pas de créneau. AUCUN notifyStatusChange, Calendar, Drive, token (SILENCIEUSE).
- Action ADMIN createAcp (même fichier) : COMBLE UN MANQUE (aucune création ACP admin avant ; seul portal/actions.ts en avait une). Garde admin, nom requis, pose syndic_id_ref ET syndic_id (les deux colonnes existent ; portail=syndic_id, migration emails_syndic=syndic_id_ref) + garde-fou 42703. Pas de géocodage. ⚠️ Effet de bord : trigger 2026-05-30_sync_acps_clients crée un client miroir type='acp'.
- OccupantsEditor (src/app/admin/interventions/OccupantsEditor.tsx) : EXTRAIT du bloc occupants de CreateInterventionModal (refactor PUR — Planning inchangé fonctionnellement, soumission byte-identique). Props { value: SlotOccupant[]; onChange; title?; hint? }. Réutilisé par Planning ET formulaire à froid. Min 1 ligne, mêmes champs/radios (conf, contact_preference).
- ColdInterventionModal + CreateInterventionButton : réf (auto si vide), statut, type (ALLOWED_TYPES_INTERVENTION, obligatoire), description, priorité, date+technicien optionnels, demandeur syndic (autocomplete ACP/syndic + création ACP inline) ou particulier (mandant+lieu+contact sur place), adresse syndic STRUCTURÉE (rue+n°/CP/ville → composée "rue, cp ville" dans interventions.adresse), occupants (deux modes). Réutilise ModalShell/ModalFooter du Planning (non modifié).

DÉCISIONS / PIÈGES :
- listOnly (pas fullPage) : fullPage masque la liste (mode tiroir détail) ; listOnly masque seulement les widgets dashboard.
- interventions.adresse = un seul texte (pas de colonnes structurées) ; particulier_contact (jsonb) garde la structure côté particulier.
- acps : PAS de soft-delete (deleted_at absent → suppression test = hard delete). Lien ACP→syndic = syndic_id_ref (canonique) + syndic_id (legacy portail). FK clients.acp_id ON DELETE SET NULL.
- Occupant « type » (locataire/propriétaire) NON capturé (Planning et éditeur partagé n'ont que conf + contact_preference ; seul le flux mail a type_occupant). À ajouter en touche dédiée si besoin (toucherait l'éditeur partagé + les deux inserts).
- Validé E2E préversion : création particulier + syndic, ACP à la volée (+ client miroir), occupants enregistrés, type obligatoire (bouton désactivé sans type). Données de test nettoyées par SQL.

INVARIANTS INCHANGÉS : crons mails toujours fermés. Préversion = base/Drive/Gmail de PROD.

BACKLOG (non bloquant) : occupant « type » dans le formulaire si demandé ; autocomplete « syndic » liste toutes les organisations (mire le Planning) ; pas de géocodage des ACP créées à la main (lat/lng null → pas de pin carte).

BACKLOG UI (signalé 2026-06-14, prochain chantier) : pastilles sidebar fausses sur admin.foxo.be — le badge « Mails » affiche 201 non lus alors que ce n'est pas le cas, et le badge « À valider » affiche 1 alors que le dashboard affiche 0 rapport à valider. À diagnostiquer : source exacte des compteurs sidebar (countUnreadMails côté Mails ; file de validation 5 sources côté « À valider », possible item résiduel du chantier file-validation en pause) vs réalité Gmail / file de validation.

## SNAPSHOT 2026-06-13 — Mails V2 Phase 4 CLOSE (PR #95) + réparation infra intervention_timeline

ÉTAT GIT : main = 33584c2 (merge PR #95, merge commit, 7 commits préservés, branche feat/mails-v2-phase4 auto-supprimée à la fusion).

PHASE 4 — CONFIRMATIONS OCCUPANTS PAR MAIL (fusionnée) :
- U1 (35d1336) : analyse-deep extrait reponse_occupant {intention ∈ confirme|refuse|contre_proposition|ambigu, occupant_cible, creneau_propose} dans analyse_raw (pas de colonne ; miroir technique type_intervention). normalizeReponseOccupant : défaut 'ambigu', jamais 'confirme' en cas de doute. Remonté à l'UI via la route analyses.
- U2 (a75af5d) : src/lib/occupants/match-mail-response.ts — parseSenderEmail + matchOccupantResponse (pur). Niveaux : 'sur' (email expéditeur == email occupant, exactement 1), 'probable' (1 match nom/appartement), 'ambigu', 'refus_contre' (jamais auto). matchByName conservateur (nom >=3 ou appartement >=2 en sous-chaîne de occupant_cible).
- U3a (3f10ca1) : src/lib/occupants/confirm-from-mail.ts — confirmOccupantFromMail idempotent (rien si conf hors {null,en_attente}), miroir colonnes de o/actions.ts, journalise intervention_timeline + miroir occupant_responses_log.
- U3b (72cca8e) : auto-confirm du cas 'sur' best-effort (try/catch) dans analyse-deep avant le return ; uniquement si classification reponse_occupant + dossier_match_id + niveau 'sur'. N'altère jamais la réponse JSON.
- U4a (f3acc45) : loader partagé occupant-response-context.ts + GET /api/admin/mails/occupant-response + POST .../confirm. Gardes admin, défense occupant ∈ dossier, recharge serveur de l'intention.
- U4b (4058592) : OccupantResponsePanel dans FicheDossierCard (bandeau 'sur' / carte 1-clic 'probable-ambigu' / alerte 'refus_contre' + créneau). key=thread_id, aucune logique de matching client.
- fix (8283317) : journalisation timeline best-effort dans le helper (update occupant = seule écriture dure). Corrige confirmation à moitié écrite + 500 si journal échoue.

RÉPARATION INFRA (prod, 2026-06-13, SQL Editor) : intervention_timeline (définie par db/migrations/2026-05-07_mail_cron.sql) n'avait JAMAIS été appliquée en prod — toutes les écritures d'historique (rapport rouvert, courtier lié, SMS, réanalyse, suppression, cron) échouaient en silence depuis le 7 mai. Table créée (CREATE TABLE IF NOT EXISTS + index + RLS admin). Ancienne table public.timeline (icone/texte/auteur_id) orpheline, plus utilisée par aucun code — à supprimer un jour.

INVARIANTS : crons mails toujours fermés volontairement. Préversion = base/Drive/Gmail de PROD.

SUITES PHASE 4 (non bloquantes) :
- 'sur' utilise messages[0]?.from (= mails_analyses.expediteur). OK si l'occupant écrit en premier ; si fil initié par FoxO, expéditeur = info@foxo.be → 'sur' ne déclenche pas, bascule carte manuelle (échec sûr). Finition : prendre le dernier message entrant.
- OccupantResponsePanel ne recharge pas le match au changement de lien dossier (seulement au changement de thread) → rouvrir le mail après avoir lié. Finition : refetch sur changement dossier_match_id.
- Bandeau 'sur' optimiste dans le cas rare occupant 'decline' qui renvoie un mail de confirmation (helper ne réécrase pas le decline).
- Doublons de réf 2026-000 + table orpheline public.timeline → nettoyage sandbox/DB.

PROCHAIN CHANTIER (demande Foxo 13/06) : page « Interventions » admin (liste de toutes les interventions + bouton de création) depuis le sidebar. Indépendant, branche propre depuis main. Audit-first : réutiliser la création de confirm-and-create (réf 2026-000, syndic_id, statut initial, safeInsertOccupants), NE PAS dupliquer ; vérifier /api/admin/interventions/search + pattern d'ajout sidebar.

# État du projet FoxO — snapshot 2026-06-12 soir (Mails V2 — Phase 3 CLOSE, PR #94 — fiche structurée IA)

- **Date du recap** : 2026-06-12 (soir)
- **HEAD git** : `c6d9f52` (merge PR #94)
- **Branche** : `main`, aligné `origin/main`. Production via Vercel.
- **Spec** : `SPEC_Chantier_Mails_V2_v1-2.md` (project knowledge). ⚠️ CRONS MAILS TOUJOURS VOLONTAIREMENT FERMÉS — rallumage = toute dernière étape du chantier, précédée du marquage en lu des mails déjà traités.

## Mails V2 — Phase 3 (fiche structurée IA + classification native) : CLOSE (PR #94, 7 commits, 4 unités)

### U1 — Classification canonique native + extraction ACP/syndic (`7f89707` + `5c2145b`)
- analyse-deep émet NATIVEMENT la `classification` canonique (mêmes 8 valeurs et critères que le prompt du cron) — validée serveur contre `MAIL_CLASSIFICATIONS`, **fallback `toCanonicalClassification(type)` conservé** (réponses sans le champ = comportement d'avant). Le `type` hérité est TOUJOURS émis : les branches UI (`type === 'demande_intervention'`) et confirm-and-create en dépendent.
- Nouveaux extraits `acp_nom` / `syndic_nom` (règle : domaine expéditeur ∈ syndics connus → nom EXACT de la liste ; interdiction d'inventer). Migration `2026-06-12_mails_analyses_phase3_fields.sql` appliquée en prod AVANT le code + committée. maxDuration analyse-deep 30 → 60.

### U2 — FicheDossierCard dans le volet (`afecc47`)
- Carte synthèse structurée entre composer et corps du mail (uniquement si fil analysé) : badges réutilisés, grille type d'intervention / adresse / ACP / syndic / n° mentionné / créneau, résumé IA, **occupants extraits en tableau**, avertissements, actions (Créer l'intervention → scroll ConfirmCreateForm ; Répondre).
- `type_intervention` n'a PAS de colonne : extrait d'`analyse_raw` côté route analyses (rétroactif, blob jamais renvoyé au client). **Accordion « Détail analyse » supprimé** de MailAnalyseActions (absorbé) ; 3 actions 1-clic + ConfirmCreateForm inchangés.

### U3 — Lier/délier manuel fil ↔ dossier (`616b376` + `f82df69`)
- Route `POST /api/admin/mails/link-to-intervention` ({ thread_id, intervention_id|null }) : écrit **UNIQUEMENT `mails_analyses.dossier_match_id`** — `intervention_mails` reste au seul cron.
- UI dans la rangée Dossier de la fiche : autocomplete inline (même route `/api/admin/interventions/search`) pour lier, « Délier » avec confirm. Badge d'en-tête + rangée se mettent à jour ensemble (refreshAnalyse).

### U4 — Réponse IA inline dans le composer (`0cf441e` + `8088404`)
- draft-reply gagne `mode: 'inline'` : renvoie le texte dans le composer — analyse OPTIONNELLE (bonus contexte), fil complet fourni au modèle, langue auto (analyse ou détection), signature sobre « Fox Group srl », **AUCUN brouillon Gmail, AUCUN envoi autonome**. Mode `gmail_draft` par défaut strictement inchangé (signature Christophe Mertens, brouillon + brouillon_gmail_id). Toujours via runAgent (mode dans l'inputSummary).
- Bouton « ✨ Rédiger avec l'IA » dans le panel Répondre : remplit le textarea (confirm avant d'écraser un texte saisi), l'admin relit/édite et envoie LUI-MÊME (sendReply intact).

## Note réutilisation (dette assumée)
- 3e implémentation locale de l'autocomplete dossier (ConfirmCreateForm, AttachToDossierButton, FicheDossierCard — même route, même debounce 300 ms). **Factoriser en `DossierSearchPicker` au 4e usage.**

## Invariants / suite
1. **CRONS MAILS TOUJOURS FERMÉS** — rallumage = toute dernière étape du chantier. ⚠️ Au rallumage : définir qui de cron/analyse-deep GAGNE sur `classification` (les deux prompts l'émettent désormais, mais analyse-deep est aujourd'hui le seul writer de la colonne).
2. **Chantier signature-pdf EN PAUSE** — branche `feat/signature-pdf` intacte (4 commits). Décisions associé en attente : couverture claire/marine/aucune + ville du « Fait à ».
3. Prochaines options : **Phase 4** (confirmations occupants), **Phase 8** (messagerie portail), ou **reprise signature-pdf**.

## Hygiène repo
- Branche `feat/mails-v2-phase3` mergée → supprimer côté GitHub si pas déjà fait.

# État du projet FoxO — snapshot 2026-06-12 (Mails V2 — Phase 2 CLOSE, PR #93 — U4 documents tech)

- **Date du recap** : 2026-06-12
- **HEAD git** : `35164eb` (merge PR #93)
- **Branche** : `main`, aligné `origin/main`. Production via Vercel.
- **Spec** : `SPEC_Chantier_Mails_V2_v1-2.md` (project knowledge). ⚠️ CRONS MAILS TOUJOURS VOLONTAIREMENT FERMÉS — rallumage = toute dernière étape du chantier, précédée du marquage en lu des mails déjà traités.

## Mails V2 — Phase 2 (pièces jointes) : CLOSE (3/3)

### Session 3/3 — U4 (PR #93, mergée) : panneau « Documents du dossier » côté technicien
- Helper lecture seule `getDriveFileMeta` dans `google-drive.ts` (fields dont `parents`, `supportsAllDrives`).
- Route `GET /api/tech/interventions/[id]/documents` : garde tech partagée (`getCurrentTech` + `verifyTechOwnsIntervention`), résolution `drive_folder_id` → fallback par ref (`resolveInterventionFolderByName`), sous-dossiers exclus (photos/ a son panneau dédié), dossier absent = état vide pas erreur.
- Route proxy `GET .../documents/[fileId]` : **VERROU CENTRAL** `meta.parents.includes(folderId)` → 403 (la RLS ne protège pas Drive) ; double borne 4 MB (méta + post-téléchargement) ; protections héritées de la route PJ #91 (sanitizeFilename, whitelist MIME, SVG jamais inline, nosniff, CSP sandbox, cache privé) ; fichiers Google natifs et >4 MB → webViewLink Drive.
- `DocumentsPanel.tsx` : chargement client post-rendu (latence Drive isolée du rendu de page), 4 états FR tutoyés, lignes tactiles 48px, intégré entre Photos et Observations.

## Leçon de session (piège fermé)
- `verifyTechOwnsIntervention` compare `iv.technicien_id` — un `opts.select` custom qui omettait la colonne donnait un **403 systématique** (`undefined !== techId`), constaté sur la préversion (panneau Documents « Intervention non assignée » alors que la page s'affichait). Corrigé (`d9fee36` : ajout de la colonne dans le select des deux routes documents) puis **DURCI dans le helper** (`0364a1e`) : `technicien_id` est désormais forcé dans tout select custom (`'*'` reconnu). Piège définitivement fermé.

## À faire (suite du chantier)
1. Prochaine étape = **choix** entre : Phase 3 (fiche structurée IA), Phase 8 (messagerie portail), lot Signature visuelle.
2. Invariant inchangé : **CRONS MAILS TOUJOURS FERMÉS** — rallumage = toute dernière étape du chantier.

## Hygiène repo
- Branche `feat/mails-v2-docs-tech` mergée → supprimer côté GitHub si pas déjà fait.

# État du projet FoxO — snapshot 2026-06-11 (Mails V2 — Phase 2 sessions 1/3 + 2/3 livrées, PRs #91 + #92)

- **Date du recap** : 2026-06-11
- **HEAD git** : `8bee31a` (merge PR #92)
- **Branche** : `main`, aligné `origin/main`. Production via Vercel.
- **Spec** : `SPEC_Chantier_Mails_V2_v1-2.md` (project knowledge — inclut la Phase 8 messagerie portail). ⚠️ CRONS MAILS VOLONTAIREMENT FERMÉS — rallumage = dernière étape du chantier, précédée du marquage en lu des mails déjà traités.
- Note : le snapshot de la session 1/3 n'avait pas été poussé — ce snapshot couvre les DEUX sessions.

## Mails V2 — Phase 2 (pièces jointes) : sessions 1/3 et 2/3 LIVRÉES
Audit d'ouverture : pipeline Agent 2 → Drive à confirm-and-create DÉJÀ complet et conforme (filtre, runAgent, table attachments, renommage [ref]_[type]_[date], résolution drive_folder_id direct, légitime car dossier créé en amont).

### Session 1/3 — U1 (PR #91, `5a48bbb`+`b8b92ac`+`08afa8d`+`6d4357c`)
- `attachment_id` exposé dans le type `MailDetail.attachments` (donnée transitait déjà au runtime).
- Route `GET /api/admin/mails/[id]/attachments/[attachmentId]` : garde admin ; name/mime fournis par le client et sanitisés serveur (JAMAIS de re-fetch Gmail — attachment_id instable entre deux lectures) ; base64url→Buffer ; 413 >4 MB (plafond Vercel) ; Content-Disposition inline images/PDF sinon attachment, filename* RFC 5987 ; **SVG jamais inline (XSS)** ; `X-Content-Type-Options: nosniff` + `CSP: sandbox` ; cache privé 5 min.
- Volet : PJ cliquables (aperçu/téléchargement), >4 MB atténué « voir dans Gmail » (pré-check client), sans attachment_id = inerte.
- Abandonné (assumé) : indicateur PJ dans la liste (format=metadata sans info PJ).

### Session 2/3 — U2 + U3 (PR #92, `f1d1359`+`f8e4ebf`+`0176a53`)
- **Migration** `db/migrations/2026-06-11_attachments_dedup.sql` committée (appliquée en prod le 2026-06-11 via SQL Editor AVANT le code) : `attachments.contenu_hash` (sha256 hex du contenu décodé), `attachments.source_mail_id`, index partiel `attachments_dedup_idx`.
- **U2 anti-doublon** : dans `analyseAttachments` — hash calculé après le filtre (décodage tolérant base64/base64url, aligné upload Drive), skip journalisé `reason:'doublon'` si row vivante (intervention_id, contenu_hash), hash+source persistés dans les deux branches d'insert ; `AttachmentInput.source_mail_id` par PJ (un thread mélange plusieurs messages — confirm-and-create passe `att.message_id`). JAMAIS de dédup sur l'attachment_id Gmail (instable).
- **U3 « Joindre au dossier »** : route `POST /api/admin/mails/[id]/attach-to-intervention` (garde admin, maxDuration 60, UUID validé, bornes 20 PJ/25 MB, liste des PJ fournie par le client — jamais de re-fetch des attachment_id, download best-effort par PJ) → délègue à `analyseAttachments` (filtre + anti-doublon + renommage + Drive hérités) ; `pj_drive_ids` MERGÉ (union) dans `mails_analyses` — jamais remplacé, et seulement si la row existe. UI : `AttachToDossierButton` encapsulé en tête de section PJ — direct vers le dossier matché, sinon sélecteur debounce sur `/api/admin/interventions/search` (route préexistante) ; feedback avec compte des doublons ignorés.

## À faire (Phase 2 puis suite)
1. **Session 3/3 — U4** : panel Documents côté tech — `listFolderFiles(drive_folder_id)` (google-drive.ts:464) + fallback `resolveInterventionFolderByName(ref, year)` (:521) ; route proxy `alt=media` À CRÉER, gardée par rôle (tech ASSIGNÉ à l'intervention ou admin — la RLS ne protège pas Drive), cache court pour les vignettes. Aucun panel Documents tech n'existe aujourd'hui (seul PhotosPanel).
2. Puis Phases 3→8 selon spec v1.2 (Phase 8 messagerie portail de préférence après Phase 2).

## Hygiène repo
- Branche `feat/mails-v2-phase2b` mergée → supprimer côté GitHub si pas déjà fait.

# État du projet FoxO — snapshot 2026-06-11 (Mails V2 — Phase 1 CLOSE, PRs #89 + #90)

- **Date du recap** : 2026-06-11
- **HEAD git** : merge PR #90 (voir git log)
- **Branche** : `main`, aligné `origin/main`. Production via Vercel.
- **Spec du chantier** : `SPEC_Chantier_Mails_V2_v1-1.md` (project knowledge). ⚠️ CRONS MAILS VOLONTAIREMENT FERMÉS pendant tout le chantier (réencodage manuel en cours) — rallumage = toute dernière étape, précédée du marquage en lu des mails déjà traités.

## Chantier Mails V2 — Phase 1 (ergonomie) : CLOSE
Audit d'ouverture : la moitié de la Phase 1 était déjà livrée (layout 2 panneaux D3, sélection multiple + masse /batch chunké, badge dossier via mails_analyses, deep-link ?id=).
- **PR #89** (`3380e5c` + `4a7234e`, mergée) : 7 onglets métier résolus côté serveur — À traiter (défaut, badge = countUnreadMails, même définition donc cohérence gratuite) / Demandes (label FoxO/Intervention) / Occupants (FoxO/Occupant) / Tous / Archivés (query `-in:inbox -in:trash -in:spam -in:draft -in:sent`, documentée) / Système / Corbeille. Filtre regex « Avec interv. » supprimé (hasInterventionRef = code mort retiré ; lien mail↔dossier = badge mails_analyses uniquement). Recherche relayée à la query Gmail (debounce 400 ms, guillemets neutralisés, borne 200 c., combinée à l'onglet actif) ; filtrage client texte retiré.
- **PR #90** (`020c611` + `a0fb69a` + `beefa53`, mergée) : actions rapides au survol des lignes (desktop : Archiver / Lu-Non lu / Important ; corbeille : Restaurer) via applyBulkActionForOne généralisé (archive/trash/restore quittent la vue ; read/unread/important patchent ligne + détail en place). Barre du volet complétée (Lu/Non-lu sur état dérivé selectedListItem ?? detail.label_ids — deep-link couvert ; Important ; Corbeille ferme le volet). Analyse unifiée : bouton + bloc legacy /analyze supprimés du client (route conservée, zéro appelant), MailAnalyseActions renommé « Analyser avec IA » = unique entrée (analyse-deep) ; préremplissage planning rebranché sur l'analyse approfondie (1er occupant_extrait → nom/tél/email, adresse_extraite, urgence → priorité, resume). Clic libellé bascule l'onglet sur Tous (piège is:unread).
- **Notes** : onglets Demandes/Occupants quasi vides tant que le cron (poseur des labels FoxO/*) est fermé — normal. Badge À traiter non décrémenté instantanément au marquage lu (rafraîchissement suivant) — cosmétique, backlog.
- **P0 (hors code)** : côté code rien à nettoyer (1 commentaire documentaire). Foxo supprime les libellés FOXO_TRAITE/FOXO_LU dans Gmail (Paramètres → Libellés) quand il veut.

## À faire (chantier Mails V2, ordre spec)
1. **Phase 2 — Pièces jointes** : téléchargement/aperçu PJ (route Gmail attachmentId, downloadGmailAttachment existe dans gmail.ts) ; copie PJ utiles → Drive dossier à confirm-and-create (filtre Agent 2, renommage <ref>_<type>.<ext>, résolution Drive par préfixe ref JAMAIS par adresse, anti-doublons, best-effort) ; bouton « Joindre au dossier » ; section Documents côté tech (à auditer).
2. Phase 3 (fiche structurée IA) → Phase 4 (confirmations occupants) → Phase 5 (sortant) → Phase 6 (relances/urgences) → Phase 7 (timeline/assistant).
- **Pièges connus pour Phase 2+** : rafale 1+N appels Gmail par fetch de liste (cache court à envisager) ; pas de pagination (limite 100) ; 3 sources lien mail↔dossier réduites à mails_analyses côté UI mais intervention_mails reste la table canonique côté serveur.

## Hygiène repo
- Branches `feat/mails-v2-phase1` et `feat/mails-v2-phase1b` mergées → supprimer côté GitHub si pas déjà fait.

# État du projet FoxO — snapshot 2026-06-11 (VOLET DESIGN CLOS — D7-bis, revue visuelle finale validée)

- **Date du recap** : 2026-06-11
- **HEAD git** : `791402b` (merge PR #88)
- **Branche** : `main`, aligné `origin/main`.
- **Production** : déployée par Vercel sur push `main`.

## Volet design : CLOS (D1→D7 + D7-bis, PRs #81→#88)
Revue visuelle finale sur 15 captures prod (3 portails + mobile tech) : conforme. Heures Europe/Brussels OK partout, titres/ombres/rayons unifiés, états vides repliés, skeletons actifs, tutoiement assistant tech confirmé en conditions réelles.

### D7-bis (PR #88, commits `ca7ee68` + `0e3d8aa`) — 3 finitions issues de la revue
- **Assistants en texte brut** : `AssistantChat.tsx` rend `{m.content}` sans parseur markdown → les réponses IA sortaient des tableaux `|...|` et du `**gras**` littéraux. Règle de formatage ajoutée aux 3 consignes système (tech tutoiement ; admin modes `global` + `intervention`, mode `rapport_json` explicitement préservé en JSON pur).
- **Mode sombre neutralisé globalement** : ~590 classes `dark:` résiduelles (36 fichiers) s'activaient via `prefers-color-scheme` quand l'OS est sombre → blocs noirs isolés (drawer admin ACP/Courtier/Messages, bloc Messages portail). Fix : `@custom-variant dark (&:where(.dark, .dark *));` dans `globals.css` juste après l'import Tailwind — la classe `.dark` n'étant jamais posée, toutes les `dark:` sont inertes (vérifié par compilation : zéro règle `prefers-color-scheme: dark` émise). FoxO = mono-thème clair, définitif. Les classes `dark:` dans les composants sont conservées mais mortes — nettoyage cosmétique possible en temps calme, non prioritaire.
- **Bouton Publier RapportPanel** : audit → rien à corriger. Actif = navy plein ; le « délavé » observé = état désactivé légitime (`disabled:opacity-40` quand `pending`/`!canPublish`/`exportingWord`, avec `title` explicatif).

## À faire (dans l'ordre) — mis à jour 2026-06-11
1. **Volet produit** — fonctionnalités manquantes, à cadrer avec Foxo. Inclut : artefact sandbox « 2026-0000 » (import Google Calendar d'un créneau de dispo importé comme intervention, titre brut d'event) à traiter côté produit.
2. **Module Analytics** (plan dans `PLAN_CHANTIER_Module_Analytics_FoxO.md`).
- (Backlog temps calme) 37 erreurs ESLint react-hooks ; casts ; sécurité BASSE (UUID occupant sans TTL, `auth_read_utilisateurs USING(true)`, CSP report-mode, secret cron en query) ; classes `dark:` mortes à purger ; chantier `feat/file-validation` en pause ; outils d'écriture Google assistant admin ; crédentials Twilio prod.
- **Facturation = DERNIER chantier**, ne pas démarrer avant usage quotidien.

## Hygiène repo
- Branche `design/d7bis-finitions` mergée → supprimer côté GitHub si pas déjà fait.

# État du projet FoxO — snapshot 2026-06-11 (clôture volet design — D7 modernisation)

- **Date du recap** : 2026-06-11
- **HEAD git** : `5f8ca8a` (merge PR #87)
- **Branche** : `main`, aligné `origin/main`.
- **Production** : déployée par Vercel sur push `main`.

## Chantier clos — D7 « modernisation » (PR #87, 4 commits, 61 fichiers)
Dernier lot du volet design (D1→D7 tous mergés, PRs #81→#87). Systématisation du « luxe B2B sobre » existant, zéro redesign, zéro changement de logique (diff relu intégralement par Claude chat avant merge).
- **Typo** (`3bd7229`) : échelle de titres unifiée dans `globals.css` — `.fxs-title-sm` 20px / `.fxs-section-title` 15px / `.fxs-block-title` 13px (Sora 600, sans couleur imposée), appliquée aux 3 portails. Chiffres tabulaires : règle globale `table { font-variant-numeric: tabular-nums }` + `tabular-nums` sur les KPI hors table.
- **Élévation** (`b3bdc04`) : tokens `@theme` — ombres `--shadow-card/raised/overlay` (teinte navy-deep) et rayons `--radius-ctl 8 / --radius-card 10 / --radius-modal 14` → utilitaires Tailwind 4 auto-générés (`shadow-card`, `rounded-modal`…). 29 `boxShadow` inline dédupliqués ; `.fxs-card`/`.premium-card` pointent sur les tokens.
- **Skeletons** (`5ae3684`) : composant `src/components/ui/Skeleton.tsx` (`Skeleton`/`SkeletonText`, classe `.fx-skeleton` sand-mid pulse 1,6s, respecte `prefers-reduced-motion`). Branché UNIQUEMENT sur des états de chargement existants (zéro nouveau fetch) : `src/app/admin/loading.tsx` (boundary Suspense des routes /admin/*), liste/libellés/détail Mails, blocs drawer interventions.
- **Micro-interactions** (`d7c8545`) : anneau de focus clavier navy 2px global via `:where(a, button, [role=button], [role=tab], summary):focus-visible` (spécificité nulle, variante sky sur surfaces navy) ; transitions 150ms couleurs/ombres sur boutons/liens/onglets/lignes ; **reliquat D6 corrigé** — prompt serveur `api/tech/assistant/chat/route.ts` passé au tutoiement.

## À faire (dans l'ordre) — mis à jour 2026-06-11
1. **Revue visuelle finale** : nouveau tour de captures avant/après par Foxo sur la prod, corrections ponctuelles si besoin.
2. **Volet produit** — fonctionnalités manquantes, à cadrer avec Foxo. Inclut l'artefact sandbox « 2026-0000 » (import Google Calendar, titre brut d'event) à traiter côté produit.
3. **Module Analytics** (plan dans `PLAN_CHANTIER_Module_Analytics_FoxO.md`).
- (Backlog temps calme) 37 erreurs ESLint react-hooks ; casts ; sécurité BASSE (UUID occupant sans TTL, `auth_read_utilisateurs USING(true)`, CSP report-mode, secret cron en query) ; classes `dark:` inertes ; chantier `feat/file-validation` en pause ; outils d'écriture Google assistant admin ; crédentials Twilio prod.
- **Facturation = DERNIER chantier**, ne pas démarrer avant usage quotidien.

## Hygiène repo
- Branche `design/d7-modernisation` mergée → supprimer côté GitHub si pas déjà fait (bouton Delete branch).

# État du projet FoxO — snapshot 2026-06-11 (Chantier Rapport v2 — LIVRÉ, PR #76 MERGÉE)

- Date du recap : 2026-06-11
- HEAD git : d34a1ae (merge PR #76)
- Branche : main, working tree propre, aligné origin/main
- Production : déployée par Vercel sur push main

## Chantier Rapport v2 — CLOS, MERGÉ (PR #76), VALIDÉ END-TO-END

Refonte complète de la génération du rapport d'intervention. PR #76 « Rapport v2 — fidélité template, pipeline vision photos, techniques cochées », branche `feat/rapport-v2`, mergée (merge commit `d34a1ae`, 15 fichiers, +833/−224). Test end-to-end VALIDÉ par Foxo sur le dossier 2026-000 : pipeline vision, techniques cochées, photos présentes dans le PDF ET le Word, fidélité au template.

### Contenu livré
- **Fidélité visuelle au template** : rendu docx fidèle au template de référence ; PDF jumeau entièrement réécrit — structure de données unifiée `ReportData` partagée entre les deux moteurs, logo extrait du template, police Carlito embarquée.
- **Données admin complètes** : facturation et occupants injectés dans le rapport.
- **Techniques d'intervention** : persistées en base (`rapports.techniques`) + cases à cocher éditables côté admin ; `rapports.techniques_a_confirmer` pour les suggestions IA en attente de validation.
- **Pipeline IA en 2 passes** : (1) agent `analyse_photo` — analyse vision de chaque photo, persistée dans `photos_interventions.analyse_ia` ; (2) agent rapport v2 — génération avec le prompt `foxo-rapport-v2.md`, alimenté par les analyses photos.
- **Photos par section** : helper partagé de répartition des photos par section du rapport, utilisé par les deux moteurs (PDF et Word), grille 2 colonnes.
- **Garde-fous** : paramètre `photos` rendu obligatoire dans les signatures concernées (garde anti-régression) ; guards sur le statut du dossier avant génération.

### Migration SQL — DÉJÀ APPLIQUÉE EN PROD
Colonnes `rapports.techniques`, `rapports.techniques_a_confirmer`, `photos_interventions.analyse_ia`. Rien à rejouer.

### Notes
- Les checks Netlify rouges sur la PR = bruit résiduel non bloquant (Netlify déconnecté du repo ; prod = Vercel).
- Hygiène repo : branche `feat/rapport-v2` à supprimer côté GitHub (« Delete branch » sur la PR #76).

## Backlog
- **Session D2 rapport** : champ légende par photo dans la PWA tech (alimente `photos_interventions.label`) ; galerie photos éditable dans le drawer admin (section/légende/ordre + badge techniques à confirmer) ; fix previews photos cassées via route proxy streamant `files/{id}?alt=media`.

---

# État du projet FoxO — snapshot 2026-06-07 (Nettoyage complet de la base — TABLE RASE avant réencodage)

- Date du recap : 2026-06-07
- Branche : main (HEAD 6b70cea au démarrage ; AUCUNE modification de code applicatif cette session)
- Production : déployée par Vercel sur push main

## Chantier — Remise à zéro de la base de production (CLOS)

Objectif : base polluée par des données créées automatiquement (pipeline mail + agenda) — doublons, données « seed », comptes de test. Décision : table rase TOTALE (transactionnel + référentiel + partenaires + techniciens), puis réencodage 100 % manuel pour refléter la réalité et tester l'onboarding. Premier dossier réencodé prévu = 2026-000 (test bout-en-bout + bac à sable permanent).

### Déroulé (audit lecture seule, puis destructif APRÈS sauvegarde validée)
1. Audit complet : inventaire des tables, couche comptes, 17 organisations, graphe des clés étrangères.
2. Sauvegarde : Supabase en plan FREE -> AUCUNE sauvegarde auto ni PITR. Export JSON complet de 22 tables via SQL Editor, téléchargé par Foxo, puis VALIDÉ au row près (interventions 49, occupants 33, organisations 17, etc.). Fichier conservé hors plateforme = seul filet de sécurité.
3. Ingestion gelée : workflows GitHub Actions DÉSACTIVÉS via l'UI (Actions -> Disable) : cron-check-mails (toutes les 10 min) et cron-calendar-watch (quotidien). deploy.yml laissé actif. NB : désactiver un workflow ne crée pas de commit.
4. Webhook calendrier audité (calendar-webhook/route.ts) : ne CRÉE rien ; seule mutation = DELETE d'un créneau « libre » à l'annulation d'un event Google. Non polluant.
5. Effacement Stage 1 (SQL transaction, Supabase) : vidé interventions + tout le transactionnel + référentiel (organisations, acps, clients, delegues) + journaux (sms_logs, agent_logs, automation_jobs) + profils partenaires/techniciens (DELETE WHERE role <> admin). GARDÉ : 2 admins, parametres, articles, google_tokens, user_preferences.
6. Effacement Stage 2 (auth.users) : supprimé 8 identités (letizida, christophe.j.mertens, tech1@foxo.be, tech2@foxo.be + orphelins letizibis, lorenzo.letizia.23, ofuitetech1, foxotech3). GARDÉ : info@foxo.be + foxotech1@gmail.com.
7. Vérifié : toutes tables métier = 0 ; utilisateurs = 2 ; auth.users = 2 ; config intacte.

### Apprentissages techniques (graphe FK) — pour de futurs nettoyages
- Liens bloquants (NO ACTION) à vider AVANT interventions : creneaux_disponibles, factures, sms_logs. sms_logs bloque aussi occupants.
- factures : auto-référence RESTRICT (facture_origine_id) -> mettre facture_origine_id et converted_to_facture_id à NULL avant DELETE.
- organisations : ne se vide qu'après interventions + acps + clients + delegues + factures + dossiers_sinistres. TRUNCATE CASCADE INTERDIT sur organisations (emporterait utilisateurs via organisation_id).
- Plan Supabase = FREE : aucune sauvegarde gérée -> toujours exporter manuellement avant tout DELETE.

## À FAIRE ENSUITE — Réencodage (point d'entrée prochaine session : « go réencodage »)
1. Vérifier d'abord Resend send.foxo.be (invitations partenaires/techniciens).
2. Créer le partenaire de test (faux syndic contrôlé par Foxo).
3. Créer un technicien de test.
4. Créer 2026-000 et la dérouler de bout en bout (création -> RDV -> confirmation occupant -> rapport -> validation -> transmission -> vue portail). Vérifier qu'on peut FORCER la référence « 2026-000 » (contourner l'auto-numérotation si besoin).
5. Encoder les vrais Regimo + IGS (coordonnées récupérables dans la sauvegarde / le CSV des 17 organisations).
- Garder les crons COUPÉS pendant tout le réencodage ; ne réactiver que sur décision.

## Résiduel (cosmétique, non bloquant)
- Fichiers Google Drive anciens (RAPPORT/{année}/...) et libellés Gmail non nettoyés — invisibles dans les portails. Nettoyage Drive = manip distincte si souhaité.

# État du projet FoxO — snapshot 2026-06-07 (PDF du rapport joint DANS LE FIL mail — mergé, à tester)

- **Date du recap** : 2026-06-07
- **HEAD git** : `983328e` (merge PR #66)
- **Branche** : `main`, working tree propre, aligné `origin/main`
- **Production** : déployée par Vercel sur push `main`.

## Chantier « PDF du rapport en pièce jointe DANS LE FIL » — CODE TERMINÉ + MERGÉ (PR #66), PAS ENCORE TESTÉ BOUT-EN-BOUT

Objectif : à la transmission d'un rapport, la réponse postée DANS LE FIL mail d'origine du syndic embarque désormais le PDF du rapport EN PIÈCE JOINTE (en plus du lien Drive déjà présent).

Deux unités, deux commits :
1. `fbbb1ce` — `src/lib/gmail.ts` : `sendMailReply` accepte un paramètre OPTIONNEL `attachment?: { filename: string; content: Buffer; contentType?: string }`. Si présent → MIME `multipart/mixed` (partie texte + partie fichier base64 replié 76 car. RFC 2045, `Content-Disposition: attachment`, nom de fichier ASCII + repli RFC 2231 si accents). Si absent → branche `else` = texte simple STRICTEMENT inchangée (rétrocompatible).
2. `3433535` — `src/lib/rapport/dispatch.ts` : l'appel `sendMailReply` (reply-in-thread, ex-« Étape 4 ») passe maintenant `attachment: { filename, content: built.pdfBuffer, contentType: 'application/pdf' }`. `filename = "{ref} {acpNom}.pdf"` (repli `"{ref}.pdf"` si `acpNom === '—'`).

**Découverte d'audit (corrige une hypothèse du récap précédent)** : `dispatch.ts` ne « résout » PAS le dossier Drive. Il fabrique le nom à partir de `ref` + `acpNom` (nom de l'ACP), exactement comme le `.docx` déjà uploadé (`"{ref} {acpNom}.docx"`). Le nom de la pièce jointe réutilise donc ce même schéma — aucune 2e résolution Drive nécessaire. Le buffer PDF est déjà disponible dans `dispatchRapportToSyndic` (`built.pdfBuffer`, type `Buffer`) — rien à régénérer.

**Garanties** : `tsc --noEmit` vert avant chaque commit. 2 appelants de `sendMailReply` confirmés (`src/app/api/admin/mails/[id]/reply/route.ts` + `src/lib/rapport/dispatch.ts`) — aucun ne casse (param optionnel). L'envoi de la réponse en fil est best-effort dans un `try/catch` non bloquant : si le MIME multipart échouait, le syndic recevrait quand même le PDF via le mail Resend (`sendRapportEmail`, pièce jointe `rapport-{ref}.pdf`) + le lien Drive.

**RESTE À FAIRE — test bout-en-bout** : sur un dossier réel `source=mail` (après réencodage des données), transmettre un rapport et vérifier dans le fil d'origine : (1) réponse dans le même fil, (2) pièce jointe PDF présente, (3) nom ≈ `"2026-XXX <ACP>.pdf"`, (4) le PDF s'ouvre. Si défaut → correction sur branche dédiée.

## Contexte opérationnel
- **Remise à zéro des données plateforme en cours** (gérée par Foxo dans une autre session) : effacement des données + réencodage manuel de toutes les interventions. Le test bout-en-bout de #66 — et le test opérationnel global triage→RDV→rapport→transmission→suivi — se feront sur ces données réencodées.

## Hygiène repo
- Branche `feat/rapport-pdf-in-thread` supprimée (distant nettoyé).
- `git fetch --prune` a aussi nettoyé localement 5 réfs distantes déjà supprimées côté GitHub : `feat/assistant-tech-chat` (#65), `claude/eloquent-knuth-N1JGG`, `feat/reference-syndic-creation`, `fix/assure-nom-data-gap`, `fix/notif-bell-panel-position`. Rien à faire.

## Pistes suivantes (inchangées, par valeur)
- Test opérationnel bout-en-bout du cycle = prérequis avant analytics (valide en passant le PDF-dans-le-fil ci-dessus).
- Reprendre `feat/file-validation` (replis d'affichage NULL).
- Backlog assistant ADMIN : outils d'ÉCRITURE Google (créer/modifier event Agenda via `createCalendarEvent`/`updateCalendarEvent` ; brouillon Gmail — vérifier l'écriture dans `gmail.ts` ; confirmer le scope Agenda en écriture). NB : `planifier_rdv` ne crée PAS d'event agenda (volontaire).
- Plus tard : Phase 5 (assistant portail cloisonné + analytics doc 06) ; Module Facturation (DERNIER chantier).

---

# État du projet FoxO — snapshot 2026-06-07 (Phase 4 étape 1 — Assistant technicien lecture seule — LIVRÉ EN PROD)

- Date du recap : 2026-06-07
- HEAD git : merge PR #65 sur main (voir git log)
- Branche : main, working tree propre, aligné origin/main
- Production : déployée par Vercel sur push main.

## Chantier — Assistant technicien (Phase 4, étape 1/3) : LECTURE SEULE — CLOS et EN PROD

PR #65, branche feat/assistant-tech-chat, 3 commits : route b882d2f, prop endpoint 8be2d93, page+nav 61331fd.

### Livré
- Route src/app/api/tech/assistant/chat/route.ts : garde rôle 'tech' EN BASE (roleForUserId(user.id) === 'tech'), outils = FOXO_READ_TOOLS UNIQUEMENT (PAS d'outils Google = boîte société, PAS d'outils d'action), client cookie-bound (RLS), AUCUN contexte global injecté, consigne système dédiée (lecture seule, vouvoiement, mobile), observabilité runAgent (assistant_chat / utility), réponse { ok, content }.
- AssistantChat : prop optionnelle endpoint (défaut route admin -> comportement admin INCHANGÉ), réutilisé côté tech.
- Page src/app/tech/assistant/page.tsx : AssistantChat mode global + endpoint tech + quick-actions tech sans icône. Mise en page : conteneur fixed entre header (top 4rem) et barre du bas (bottom calc safe-area + 84px), z-30, max-w 640px (robuste vis-à-vis de MainContentTech).
- TechBottomNav : 4e item Assistant (icône Sparkles, /tech/assistant) entre Historique et Notes.

### Cloisonnement — garanti par la RLS, CONFIRMÉ en conditions réelles
- interventions = FORCE ROW LEVEL SECURITY ; policies tech limitent à technicien_id = auth.uid() / current_utilisateur_id() (invariant utilisateurs.id == auth.uid()).
- buildGlobalContext (sans arg) ET buildInterventionContext = cookie-bound (RLS). get_intervention_detail/list_intervention_documents : résolution ref RLS-bound puis contexte RLS-bound (double barrière).
- TEST aperçu Vercel #65, connecté tech2 (Christophe, 1 seul dossier 2026-132) : « mes interventions » -> SEULEMENT 2026-132 ; détail 2026-116 (dossier tech1) -> REFUSÉ ; détail 2026-132 (le sien) -> OK. Affichage mobile OK. Cloisonnement prouvé.

### Pièges évités / cosmétique
- NE JAMAIS donner GOOGLE_READ_TOOLS au tech. NE JAMAIS appeler buildGlobalContext(createAdminClient()) côté tech (= bypass RLS).
- Cosmétique à polir : thème admin (navy) au lieu du vert tech ; placeholder du champ en formulation admin/tutoiement.

### Divergence de garde connue (non bloquante)
- Page /tech (layout) = roleForEmail (whitelist TECH_EMAILS) ; route API = roleForUserId (rôle DB). À réconcilier un jour.

## Suite Phase 4
- Phase 4-bis : Google PERSONNEL du tech (OAuth PAR UTILISATEUR, stockage + refresh des jetons par tech) = le gros morceau sensible.
- Phase 4-ter : outils d'ACTION côté tech (avec confirmation).

## Backlog ajouté
- Outils d'ÉCRITURE Google pour l'assistant ADMIN : créer/modifier événement Agenda (createCalendarEvent/updateCalendarEvent dans google-calendar.ts, moule propose->confirme->exécute comme planifier_rdv) + brouillon Gmail (vérifier l'écriture dans gmail.ts). Vérifier scopes OAuth (Gmail/Drive complets, CONFIRMER Agenda en écriture). planifier_rdv ne crée PAS d'event agenda (volontaire).

## Hygiène repo
- feat/assistant-tech-chat à supprimer (Delete branch sur PR #65 après merge).

---

# État du projet FoxO — snapshot 2026-06-07 (Assistant Phase 3 — valider_rapport + transmettre_rapport — LIVRÉ EN PROD)

- Date du recap : 2026-06-07
- HEAD git : b940b88 (merge PR #64)
- Branche : main, working tree propre, aligné origin/main
- Production : déployée par Vercel sur push main.

## Chantier — Assistant Phase 3 : valider + transmettre rapport — CLOS et EN PROD

Deux actions propose-only ajoutées à l'assistant IA admin, sur le moule exact des 3 précédentes (assign_technician, relance_occupants, planifier_rdv). PR #64 (merge b940b88, commit feature c2631ac, branche feat/assistant-rapport-actions). 2 fichiers, +196/-7.

### Livré
- propose_valider_rapport(ref) dans src/lib/assistant/tools/foxo-actions.ts : lecture seule, résout l'intervention par ref + lit rapports.statut. Refuse si aucun rapport / déjà valide / déjà transmis ; propose seulement si brouillon. Aucun envoi.
- propose_transmettre_rapport(ref) : refuse si aucun rapport / brouillon (« validez d'abord ») / déjà transmis ; propose seulement si valide. Action la plus sensible (e-mail réel au syndic).
- Case valider_rapport dans api/admin/assistant/actions/execute/route.ts : délègue à validateRapport (garde admin interne + .eq('statut','brouillon')).
- Case transmettre_rapport : BARRIÈRE anti-double-envoi / anti-brouillon — relit rapports.statut, exige === 'valide' (sinon HTTP 409), puis délègue à resendRapportToSyndic (→ dispatchRapportToSyndic : envoi réel + reply-in-thread Gmail + upload Drive + statut transmis).
- ActionName étendu à 5 valeurs. Aucun changement chat route (dispatch dynamique FOXO_ACTION_TOOLS.some(...)) ni UI (carte de confirmation générique). Aperçu Vercel construit OK.

### Validation (aperçu Vercel PR #64, lecture seule, ZÉRO mutation, ZÉRO e-mail)
- Validation sur dossier sans rapport (2026-133) -> refus correct « rien à valider ». OK
- Validation sur brouillon (2026-116) -> carte de validation correcte. OK
- Transmission sur brouillon (2026-116) -> BLOQUÉE (« doit d'abord être validé »), aucune carte d'envoi. OK
- tsc --noEmit vert. Merge commit confirmé.
- NON exercé volontairement : le clic « Exécuter » réel (mutation valide / envoi transmis) — sera validé à la 1re utilisation réelle. publishRapport (tech) jamais exposé.

### Repères
- Cycle rapport : brouillon (publié par tech via publishRapport) -> valide (validateRapport, createAdminClient) -> transmis (dispatchRapportToSyndic, createAdminClient).
- dispatchRapportToSyndic n'impose AUCUNE précondition de statut en interne -> la garde « doit être validé » est portée par l'outil propose + le re-check 409 dans la route execute.
- Lectures rapports = client RLS-bound OK pour l'admin ; mutations = createAdminClient. FK = intervention_id, un rapport par intervention (.maybeSingle()).
- Table rapports au 2026-06-07 : 2 lignes, toutes deux brouillon (2026-116, 2026-100). Aucun valide/transmis.

## Suite
- 1re utilisation réelle valider->transmettre (ex. 2026-116 quand prêt) = bout-en-bout naturel, à accompagner en direct.
- Phase 4 (assistant tech, OAuth Google PAR UTILISATEUR), Phase 5 (portail cloisonné + analytics doc 06).

## Hygiène repo
- Supprimer via GitHub « Delete branch » les branches mergées encore présentes (#61, #62, #63 ; #64 supprimée au merge).

---

# État du projet FoxO — snapshot 2026-06-07 (Assistant Phase 3 : action planifier_rdv livrée)

- **Date du recap** : 2026-06-07
- **HEAD git** : merge PR #63 sur `main` (voir `git log`)
- **Branche** : `main`, working tree propre
- **Production** : déployée par Vercel sur push `main`.

## Extension #2 du pattern Phase 3 — `planifier_rdv` : LIVRÉE, MERGÉE, EN PROD (PR #63)

Nouvel outil d'action de l'assistant admin, même moule que `assign_technician` / `relance_occupants` (propose → carte de confirmation → exécution sur clic humain).
- **`src/lib/assistant/tools/foxo-actions.ts`** : `ActionName` étendu à `'planifier_rdv'` ; outil propose-only `propose_planifier_rdv(ref, date, heure)` (résout l'intervention, valide AAAA-MM-JJ + HH:MM en lecture seule, avertit si un créneau existe déjà) ; dispatch + fonction `proposePlanifierRdv`.
- **`src/app/api/admin/assistant/actions/execute/route.ts`** : `case 'planifier_rdv'` → re-valide, calcule l'ISO, `update interventions set creneau_debut + statut='attente'`. AUCUN email, AUCUN événement Google Agenda. Garde `isAdminUser`.
- **Choix d'archi** : logique recopiée à l'identique de la route manuelle sœur `src/app/api/admin/interventions/[id]/schedule/route.ts` (mini-duplication ~6 lignes assumée + commentaire), pour NE PAS toucher la route manuelle en prod. Extraction d'un helper partagé reportée à un 3e appelant.
- Aucun changement chat ni UI (carte générique, outils câblés via `FOXO_ACTION_TOOLS`).
- Commit feature `f3ca300` (2 fichiers, +92/−1). `tsc` vert.
- **Validé en prod** (aperçu = même base) sur 2026-133 : carte affichée (avertissement « remplace le créneau du 9 juin 19h ») → Exécuter → dossier replanifié au 12/06/2026 10:30 + statut `attente`.

## Suite (par risque croissant) — pattern Phase 3
- planifier RDV ✅. Reste : **valider rapport** (`validateRapport`) → **transmettre rapport au syndic** (`dispatchRapportToSyndic`, la plus sensible : vrai envoi au syndic). NE PAS exposer `publishRapport`.
- Puis Phase 4 (assistant tech, OAuth Google par utilisateur), Phase 5 (assistant portail + analytics doc 06).

## Backlog / à surveiller
- Incohérence d'adresse sur la carte de relance (2026-133 : « av Louis 22, 1050 Ixelles » vs détail « Avenue Louise 279 »). La carte `planifier_rdv` affichait la bonne adresse → l'écart venait probablement de la prose du modèle sur la relance, pas des données. Mini-vérif un jour.

## Hygiène repo
- Supprimer la branche mergée `feat/assistant-action-planifier-rdv` (PR #63).

---

# État du projet FoxO — snapshot 2026-06-07 (fiabilité assistant : fix détail dossier + alignement schéma occupants)

- **Date du recap** : 2026-06-07
- **HEAD git** : `539aede` (merge PR #62)
- **Branche** : `main`, working tree propre, aligné `origin/main`
- **Production** : déployée par Vercel sur push `main`.

## Chantier fiabilité de l'assistant — fix #1 LIVRÉ EN PROD (PR #62)

Bug « détail indisponible » corrigé. `get_intervention_detail` (foxo-read.ts) trouvait bien l'id du dossier (étage 1, requête simple), puis déléguait à `buildInterventionContext` (context.ts, étage 2) qui rechargeait l'intervention AVEC jointures `acp:acps(*), syndic:organisations(*), technicien:utilisateurs(*)`.

- **Cause racine confirmée par les FK live** : `interventions` référence `organisations` DEUX fois — `organisation_id` (`interventions_organisation_id_fkey`) ET `syndic_id` (`interventions_syndic_id_fkey`). L'embed `syndic:organisations(*)` sans désambiguïsation → PostgREST rejette TOUTE la requête (relation ambiguë). Et le code ne lisait que `{ data: iv }` (jamais `error`) → erreur avalée → message trompeur « détail indisponible » alors que le dossier existe.
- **Correctif** (commit `50c5a9e`, +6/−2, fichier `src/lib/assistant/context.ts`) : (1) embed désambiguïsé → `syndic:organisations!syndic_id(*)` ; (2) `error` capturé + journalisé (`console.error`) avant `return null` — fini l'aveuglement.
- **Portée** : `buildInterventionContext` sert le contexte dossier de TOUT l'assistant (pas que l'outil détail) → fix global.
- **Validé en prod** (aperçu Vercel = même base) sur dossier de test **2026-133** : détail complet rendu, syndic « MERTENS Syndic » affiché (preuve que le bon lien est `syndic_id`, pas `organisation_id`).
- **Découverte #3 (get_intervention_detail cassé) → RÉSOLUE.**
- **Découverte #4 (court-circuit : l'assistant pré-vérifiait via le détail cassé et répondait « introuvable » sans appeler l'outil propose) → CONFIRMÉE RÉSOLUE (2026-06-07)** : test d'action « relance les occupants du dossier 2026-133 » en prod → l'assistant a appelé l'outil propose et affiché la carte de confirmation (aucun envoi déclenché). Le fix de `get_intervention_detail` a résolu #3 ET #4.

## Reprises du récap précédent — désormais actées au dépôt

### Extension #1 Phase 3 — `relance_occupants` (PR #61, merge `fd08ecf`, commit `6f907cf`)
LIVRÉE, MERGÉE, EN PROD. Outil propose-only `propose_relance_occupant(ref)` (`foxo-actions.ts`) + `case 'relance_occupants'` dans `actions/execute/route.ts` → `notifyOccupantsForIntervention`. `maxDuration` 60. Validé prod sur 2026-133 (« 1 envoi réussi » + email reçu).

### Dérive de schéma `occupants` corrigée en prod (CRITIQUE)
La migration `db/migrations/2026-05-23_occupants_response.sql` n'avait JAMAIS été appliquée à la prod. Prod : colonne égarée `confirme_at`, aucune de `confirmed_at` / `proposed_creneau_debut` / `proposed_creneau_fin` / `response_note`, ni la table `occupant_responses_log`. Symptôme : clic « je serai présent » → erreurs PostgREST. Correctif via SQL Editor : rename `confirme_at → confirmed_at` (données préservées) + ré-application idempotente complète. « Je serai présent » fonctionne.
- **Acté au dépôt** : fichier `db/migrations/2026-06-07_occupants_response_align_prod.sql` (idempotent, no-op en prod) enregistrant ce réalignement. Inutile de le rejouer dans Supabase.
- **Leçon clé** : toujours vérifier le schéma LIVE via `information_schema`, jamais seulement les fichiers de migration. Le dépôt était cohérent ; la PROD avait dérivé.

## Repères utiles
- **Aperçu Vercel = MÊME base Supabase que la prod.** Dossier de test sûr : **2026-133** (occupant `foxotech1@gmail.com`). Outils de LECTURE sans risque ; outils d'ACTION (relance) déclenchent de vrais envois.
- **Bon FK syndic** : `interventions.syndic_id` (PAS `organisation_id`) pour joindre l'`organisations` syndic/courtier.
- **Backlog — incohérence d'adresse (à vérifier)** : sur 2026-133, la carte de relance affichait « av Louis 22, 1050 Ixelles » alors que le détail affichait « Avenue Louise 279, 1050 Bruxelles ». Soit données de test incohérentes (`interventions.adresse` libre vs adresse de l'ACP liée), soit le modèle paraphrase/invente l'adresse dans le texte de la carte d'action (plus gênant). Mini-vérif un jour : comparer ce que renvoie l'outil propose vs ce que le modèle écrit.

## Suite (par risque croissant) — pattern Phase 3
1. (optionnel) Confirmer #4 par un test d'action sur 2026-133.
2. planifier RDV (`createCalendarEvent`) → valider rapport (`validateRapport`) → transmettre rapport au syndic (`dispatchRapportToSyndic`, la plus sensible). NE PAS exposer `publishRapport` (côté tech).
3. Puis Phase 4 (assistant tech, OAuth Google par utilisateur), Phase 5 (assistant portail + analytics doc 06).

## Hygiène repo
- Supprimer les branches distantes mergées `fix/assistant-detail-join-ambiguity` (PR #62) et `feat/assistant-action-relance-occupant` (PR #61) via le bouton « Delete branch » sur GitHub.

---

# État du projet FoxO — snapshot 2026-06-07 (Phase 3 — PILOTE assistant « assigner un technicien » EN PROD)

- **Date du recap** : 2026-06-07
- **HEAD git** : `2e2e62b` (merge PR #60 — Phase 3 pilote)
- **Branche** : `main`, working tree propre (vérifier le HEAD live en début de session)
- **Production** : déployée par Vercel sur push `main`.

## Chantier Assistant IA — Phase 3 (outils d'ACTION admin) : PILOTE CLOS ET EN PROD

**Décision d'architecture (cœur de la Phase 3)** : le modèle n'exécute JAMAIS une action, il la **PROPOSE** seulement. Seul un **clic humain** l'exécute.
- Outils d'action **propose-only** : résolvent + valident en lecture seule, renvoient `{ resultForModel, pendingAction }`. Aucune mutation.
- La route chat attache les `pendingAction` à sa réponse JSON → le front affiche une **carte de confirmation** (Exécuter / Annuler).
- Le bouton « Exécuter » appelle une **route dédiée gardée admin** qui, elle seule, mute (via l'action canonique existante). Le modèle n'a aucun accès à cette route.

**Pilote livré = action `assign_technician`** (branche `feat/assistant-action-assign-tech`, mergée PR #60). 5 commits :
1. `687de1b` — `src/lib/assistant/tools/foxo-actions.ts` (nouveau) : `FOXO_ACTION_TOOLS` + `executeFoxoActionTool` + outil `propose_assign_technician(ref, technicien)`. Types `ActionName`, `PendingAction { id, action, params, summary }`, `ActionToolResult`.
2. `99d681c` — câblage `src/app/api/admin/assistant/chat/route.ts` : `tools = [...FOXO_READ_TOOLS, ...GOOGLE_READ_TOOLS, ...FOXO_ACTION_TOOLS]` (désactivés en `rapport_json`) ; dispatch 3 branches dans la boucle tool-use ; accumulateur `pendingActions` ; réponse `{ ok, content, pendingActions }`.
3. `854eed1` — `src/app/api/admin/assistant/actions/execute/route.ts` (nouveau) : `POST` gardé `isAdminUser()` (403 sinon), `case 'assign_technician'` → server action canonique `assignTechnician(interventionId, technicienId)`, `maxDuration = 30`. Déclenchée uniquement par clic humain.
4. `f8f25d1` — UI : `src/components/admin/ActionConfirmCard.tsx` (nouveau, carte générique réutilisable, états `idle → executing → done | error | cancelled`, bouton « Réessayer » sur erreur) + `src/app/admin/assistant/AssistantChat.tsx` (`ChatMessage`/`ApiResponse` étendus de `pendingActions?`, rendu d'une carte par action sous chaque message assistant).
5. `e7b6152` — **fix résolution technicien** : la recherche `prenom.ilike.%q% OR nom.ilike.%q%` échouait pour tout nom composé (« Tech 1 » = prénom « Tech » + nom « 1 », et plus tard « Jean Dupont »). Remplacée par une **correspondance souple par mots** : on récupère les techniciens actifs (`role='technicien'`, `actif=true`, limit 500) puis on garde ceux dont CHAQUE mot de la requête figure dans le prénom OU le nom.

**Validé en prod** : « Assigne le technicien Tech 1 au dossier <ref> » → carte affichée → clic Exécuter → assignation réelle confirmée. Aucune migration SQL.

**Note UI** : le widget Dashboard `src/components/admin/ChatIA.tsx` reste en **lecture seule** (il n'affiche pas les cartes d'action — il ignore `pendingActions`). Les actions sont réservées à la page `/admin/assistant`. Cohérent avec « confirmation explicite ».

**Zone assistant confirmée NÔTRE** : `api/admin/assistant`, `foxo-read.ts`, `foxo-actions.ts`, `FOXO_ACTION_TOOLS`. (L'ancienne note « zone d'un associé » était périmée.)

## À faire — extension du pattern (par risque croissant)
Réutiliser l'échafaudage (outil propose-only + nouvelle branche `case` dans la route execute + carte générique existante) :
1. **relancer occupant** — `notifyOccupantsForIntervention` (`src/lib/occupants/notify-occupants.ts`)
2. **planifier RDV** — `createCalendarEvent` (`src/lib/google-calendar.ts`)
3. **valider rapport** — `validateRapport` (`src/app/admin/actions.ts`)
4. **transmettre rapport au syndic** — `dispatchRapportToSyndic` (`src/lib/rapport/dispatch.ts`) — la plus sensible
- `publishRapport` est côté technicien → **NE PAS** l'exposer dans l'assistant admin.

Puis (plus tard) : Phase 4 (assistant tech, OAuth Google par utilisateur), Phase 5 (assistant portail cloisonné + analytics doc 06).

## Note data (futur test de bout en bout)
- Comptes de test confirmés en base `utilisateurs` (actifs, rôle `technicien`) : `tech1@foxo.be` (prénom « Tech » / nom « 1 »), `tech2@foxo.be` (« Tech » / « 2 »). Pas un trou de config — c'est juste le nommage. Le test de bout en bout (7 étapes) reste à faire ; prérequis encore à confirmer : DNS Resend `send.foxo.be` vérifié, compte syndic de test.

---

# État du projet FoxO — snapshot 2026-06-07 (Notif-retard technicien — LIVRÉ EN PROD)

- **Date du recap** : 2026-06-07
- **HEAD git** : `f0ccb1d` (merge PR #59)
- **Branche** : `main`, working tree propre, aligné `origin/main`
- **Production** : déployée par Vercel sur push `main`.

## Chantier — Notif-retard technicien — CLOS et EN PROD

Bouton « Prévenir d'un retard » sur la fiche intervention du portail technicien (`src/app/tech/interventions/[id]/page.tsx`). Sous chaque occupant ayant un téléphone, une ligne « Prévenir d'un retard : [SMS] [WhatsApp] » ouvre la messagerie native du tech (deep-links `sms:<num>?&body=…` et `https://wa.me/<num>?text=…`) pré-remplie avec le numéro de l'occupant et un message poli. Le message part du **propre numéro du tech** → contourne l'absence de credentials Twilio prod.

- **PR #59** mergée, merge commit `f0ccb1d` ; commit feature `a2c29de` (branche `feat/tech-notif-retard-occupant`, supprimée).
- Server component inchangé : pas de client component, pas de SQL, aucune écriture DB, aucun envoi serveur. +74/−19 sur 1 fichier.
- Message construit côté serveur par `buildRetardMessage(iv)` : réf. dossier + heure du créneau injectées si présentes ; texte neutre (zéro jargon métier, zéro marque) conforme doc 02.
- Helpers ajoutés en bas du fichier : `cleanDialNumber` (sms), `normalizeWaNumber` (WhatsApp : `00…` retire le 00, `0…` préfixe `32` belge), `buildRetardLinks`.
- Réutilise le pattern du bouton « Appeler » existant (`tel:`). Cibles tactiles min 44px.

### Validation
- `tsc --noEmit` vert (hook pre-push OK). Vercel preview vert (Netlify rouge ignoré, prod = Vercel).
- Mécanisme deep-link testé manuellement sur téléphone (lien `wa.me` équivalent) : WhatsApp s'ouvre pré-rempli, normalisation belge `0488…`→`32488…` confirmée.
- Rendu du bouton DANS le portail tech : NON vérifié en session (pas de compte tech de test dispo). Même `<a href>` que « Appeler » déjà en prod → risque minime. À faire confirmer par un technicien sur sa prochaine intervention.

### Apprentissage
- À la réécriture du fichier via heredoc, les 4 balises `<a` d'ouverture ont sauté au copier-coller (lignes `href=…` orphelines) — variante du drop de chevrons. Correction locale autorisée, `tsc` vert ensuite. Pour toute réécriture de fichier JSX : prévoir explicitement l'autorisation de rétablir chevrons/balises sautés.

## Suite possible
- Faire confirmer le rendu par un technicien (coup d'œil 30 s).
- (Prérequis noté) Créer un compte technicien de test pour vérifier soi-même les futures évolutions du portail tech.
- Hors session courte : Phase 3 (outils d'ACTION admin de l'assistant), walkthrough portails partenaires.

---

# État du projet FoxO — snapshot 2026-06-06 (Assistant — Phase 2-bis : listing documents Drive)

- Date du recap : 2026-06-06
- Branche : main (vérifier le HEAD live en début de session)
- Production : déployée par Vercel sur push main.

## Chantier Assistant — Phase 2-bis (Drive lecture) — CLOS et VALIDÉ EN PROD

Nouvel outil de LECTURE pour l'assistant admin : lister les documents du dossier Google Drive d'une intervention. Lecture seule, cloisonnement admin inchangé.

- Outil `list_intervention_documents` (ajouté à FOXO_READ_TOOLS dans src/lib/assistant/tools/foxo-read.ts) : prend une référence (ex. 2026-127), résout le dossier Drive, liste son contenu (nom, type, date, taille, lien). Dispatché automatiquement par la route (aucune modif route). Désactivé en format=rapport_json comme les autres outils.
- Helper `listFolderFiles(folderId, maxFiles=200)` dans src/lib/google-drive.ts : liste les enfants directs d'un dossier (fichiers + sous-dossiers), hors corbeille, dossiers d'abord puis tri date décroissante, pagination. Lecture seule.
- Helper `resolveInterventionFolderByName(ref, year)` dans src/lib/google-drive.ts : retrouve le dossier par sa RÉFÉRENCE (qui préfixe le nom du dossier), recherche `name contains` + filtre anti-faux-positif, dans RAPPORTS/{year}/ puis repli RAPPORTS/. Lecture seule, sans création.
- Validé prod sur 2026-127 (« Rue Willems 14 ») : 21 éléments listés (docx + pdf, 2 vidéos, 17 photos).

PRs : #55 (helper listFolderFiles + outil), #56 (1er repli par nom — REMPLACÉ), #57 (résolution par référence — version retenue).

### Apprentissages clés (Drive)
- `interventions.drive_folder_id` n'est PAS fiable : souvent NULL (les uploads rapport/photos retrouvent le dossier par son NOM et n'écrivent pas l'ID en retour).
- L'adresse en base (`interventions.adresse`, ex. « Bruxelles ») ne correspond PAS toujours au nom réel du dossier Drive (ex. « 2026-127 Rue Willems 14 »). Ne jamais reconstruire le nom de dossier à partir de l'adresse base.
- Clé de résolution fiable = la RÉFÉRENCE, qui préfixe toujours le nom du dossier. Structure prod confirmée : RAPPORT/{année}/{ref + adresse}/.
- Scope Google `…/auth/drive` (complet) déjà en place : pas de nouveau scope pour lister.

## À faire (dans l'ordre) — mis à jour 2026-06-06 (post Phase 2-bis)
1. Assistant — Phase 3 : outils d'ACTION admin (relancer / assigner / planifier / valider-envoyer rapport) AVEC confirmation obligatoire. Audit-first des server actions existantes.
2. Walkthrough portails partenaires (audit par clics).
- (Backlog) Notif-retard technicien (deep link sms: / wa.me, messagerie native du tech).
- Phases 4 (assistant tech, OAuth Google PAR UTILISATEUR) et 5 (assistant portail cloisonné + analytics doc 06).

## Hygiène repo
- Supprimer les branches mergées via GitHub.com : feat/assistant-agent-drive-read, fix/assistant-drive-resolve-by-name, fix/assistant-drive-resolve-by-ref.

---

# État du projet FoxO — snapshot 2026-06-06 (clôture : réf. syndic à la création)

- **Date du recap** : 2026-06-06
- **HEAD git** : `99481bc` (merge commit PR #54)
- **Branche** : `main`, working tree clean, aligné `origin/main`.
- **Production** : déployée par Vercel sur push `main`.

### Chantier clos — Réf. syndic capturée à la création (PR #54, merge `99481bc`)
Suite de l'Option C. Le formulaire « nouvelle demande » du portail syndic capture désormais la référence interne du syndic et l'écrit dans `interventions.reference_externe` (colonne réutilisée — aucune migration). Commit `3f93d53`, 2 fichiers :
- `src/app/portal/actions.ts` — `RequestInput.reference_externe?` + écriture conditionnelle dans l'insert `interventions` (exclusive de la réf. sinistre courtier/expert).
- `src/app/portal/nouveau/NewRequestClient.tsx` — état `referenceSyndic`, transmis à `submitRequest` en mode syndic ; champ optionnel dans le sous-composant `Step1`, libellé via `vocab.referenceLabel` (zéro hardcode), passé en prop.
Validé : `tsc --noEmit` vert + test end-to-end sur preview Vercel.

### En suspens (non bloquant)
- **Doc 04 (externe au repo)** : la table `interventions` y est décrite avec `ref_syndic` / `ref_courtier` / `ref_foxo`, qui ne collent pas au schéma réel (colonne unique `reference_externe` libellée par rôle ; clé `ref`). À recouper avec le schéma Supabase live puis corriger la source.
- Branche `feat/reference-syndic-creation` mergée → à supprimer côté distant (bouton GitHub « Delete branch »).

---

# État du projet FoxO — snapshot 2026-06-06 (clôture session : renommage UI + widget Dashboard branché)

- **Date du recap** : 2026-06-06 (fin de session)
- **Branche** : `main` (vérifier le HEAD live en début de session — main a bougé via une PR tierce #52)
- **Production** : déployée par Vercel sur push `main`.

## Clôtures de cette session (en prod)

- **Renommage UI « Claude » → « Assistant FoxO » / « IA »** (PR #51) : toutes les mentions VISIBLES neutralisées (badges, titres, libellés, placeholders, toasts, aria-labels) côté admin et portail tech. Non touché : technique interne (agent_name `assistant_chat`, `ClaudeAnalyse`, `analyzeMailWithClaude`, commentaires, fichiers .ts).
- **Widget Tableau de bord branché** (mergé + testé en prod) : `src/components/admin/ChatIA.tsx` n'est plus un stub. Il appelle `POST /api/admin/assistant/chat` (mode global), affiche la conversation (zone scrollable + indicateur « réfléchit… »), gère les erreurs via toast, et propose un lien « Continuer dans l'Assistant → » vers `/admin/assistant`. Style et comportement mobile (suggestions repliables) conservés. Lecture seule, 1 fichier modifié.

Suite du chantier Assistant (prochaines sessions) : Phase 3 (outils d'ACTION admin avec confirmation), option Drive (helper `listFolderFiles`), puis Phase 4 (assistant tech, OAuth Google par utilisateur) et Phase 5 (assistant portail cloisonné + analytics doc 06). Détails dans les snapshots Phase 1 / Phase 2 ci-dessous.

---

# État du projet FoxO — snapshot 2026-06-06 (Assistant agent outillé, Phase 2 — Gmail + Agenda)

- **Date du recap** : 2026-06-06
- **HEAD git** : `f96e83f` (merge PR #52 — chantier Référence syndic)
- **Branche** : `main` — working tree clean (Phase 2 mergée ; vérifier le HEAD live en début de session)
- **Production** : déployée par Vercel sur push `main`.

## Chantier Assistant IA agentique — Phase 2 CLOSE

- **Phase 2 — Outils de LECTURE Gmail + Agenda (admin)** : CLOS et VALIDÉ EN PROD. Branche `feat/assistant-agent-google-read` (commits `f10d81e` + `b1eab18`), mergée.
  - Nouveau module `src/lib/assistant/tools/google-read.ts` — 4 outils lecture seule : `search_emails` (recherche boîte société, syntaxe Gmail), `get_email_thread` (fil complet par thread_id), `count_unread_emails`, `list_calendar_events` (agenda sur fenêtre de dates).
  - Emballe des fonctions existantes (`listInboxMails`, `getEmailThread`, `countUnreadMails` de `gmail.ts` ; `getCalendarEvents` de `google-calendar.ts`). S'appuie sur le token Google applicatif UNIQUE de la société (`getValidAccessToken`) — aucune nouvelle plomberie d'auth. Dégradation propre si Google non connecté.
  - Route `chat/route.ts` : `tools = [...FOXO_READ_TOOLS, ...GOOGLE_READ_TOOLS]` (mode texte ; désactivés en `rapport_json`). Dispatch : nom dans FOXO_READ_TOOLS → `executeFoxoReadTool(…, supabase)`, sinon `executeGoogleReadTool(…)` (sans Supabase).
  - Confidentialité : corps de mails JAMAIS journalisés (runAgent ne logge que des compteurs). Cloisonnement actuel = ADMIN seul (garde `isAdminUser` au niveau route).
  - Validation prod : « combien de mails non lus + liste » → 201 non-lus + 10 fils listés ; preuve intrinsèque (le contexte de l'assistant ne contient aucun mail Gmail).
  - DRIVE REPORTÉ : `google-drive.ts` n'a pas de primitive de listing de fichiers (orienté écriture/upload). Pour un outil Drive : ajouter un helper de lecture `listFolderFiles(folderId)` — itération dédiée.

## À faire (dans l'ordre) — mis à jour 2026-06-06 (post Phase 2)
1. Assistant — Phase 3 : outils d'ACTION admin (relancer / assigner / planifier / valider-envoyer rapport) AVEC confirmation obligatoire. Audit-first des server actions existantes.
2. (option) Phase 2-bis Drive : helper `listFolderFiles` + outil de listing des documents d'un dossier.
3. Walkthrough portails partenaires (audit par clics).
- (Backlog) Notif-retard technicien (deep link sms: / wa.me, messagerie native du tech).
- Phases 4 (assistant tech, OAuth Google PAR UTILISATEUR) et 5 (assistant portail cloisonné + analytics doc 06) — plus tard.

## Hygiène repo
- Supprimer branches distantes mergées : `feat/assistant-agent-readtools` (Phase 1) et `feat/assistant-agent-google-read` (Phase 2) — bouton « Delete branch » sur les PR (push --delete échoue en 403 dans le sandbox).
- Branche externe `origin/feat/reference-syndic-portail` = travail tiers, HORS chantier Assistant — ne pas toucher.

---

# État du projet FoxO — snapshot 2026-06-06 (fin session — Assistant agent outillé, Phase 1)

- **Date du recap** : 2026-06-06
- **HEAD git** : `4be0a75` (merge PR #49)
- **Branche** : `main`
- **Production** : déployée par Vercel sur push `main`.

## Chantier Assistant IA agentique — avancement

Transformation de `/admin/assistant` (chat lecture seule) en agent outillé, cloisonné CÔTÉ SERVEUR (jamais via le prompt). Phasage 0 → 5 ; chaque phase livrable seule.

- **Phase 0 — Fix crash page** : CLOS. PR #48 (`6e9d49b`). La page passait des icônes lucide en props à un client component (interdit en RSC). En prod.
- **Phase 1 — Outils de LECTURE FoxO** : CLOS et VALIDÉ EN PROD. PR #49 (`4be0a75`), branche `feat/assistant-agent-readtools` (commits `a91dbab` + `6c2c806`).
  - Nouveau module `src/lib/assistant/tools/foxo-read.ts` — 3 outils lecture seule : `search_interventions` (recherche dans toute la base au-delà des 80 du contexte : query / statut / priorité / non_assignée / dates), `get_intervention_detail` (fiche complète par `ref`, réutilise `buildInterventionContext`), `get_pipeline_stats` (agrégats sur l'ensemble du pipeline).
  - Route `src/app/api/admin/assistant/chat/route.ts` : boucle tool-use (MAX_TURNS = 6), `export const maxDuration = 60`. Outils actifs en mode texte (global + intervention), DÉSACTIVÉS en `format=rapport_json` (comportement rapport inchangé). Chaque appel modèle journalisé via `runAgent` (agent_name `assistant_chat`, kind `utility`) — doc 02 §10 respecté.
  - Cloisonnement : outils RLS-bound (client de la route + garde admin déjà en place). AUCUNE écriture / envoi / suppression.
  - Validation : `tsc` vert, build Vercel Preview vert, test prod (« total interventions par statut ») correct ; `agent_logs` confirme tour 0 `stop_reason=tool_use tool_calls=[get_pipeline_stats]` puis tour 1 `end_turn`. `ANTHROPIC_API_KEY` présente sur Production ET Preview (Vercel).
  - Hygiène restante : branche `origin/feat/assistant-agent-readtools` à supprimer (non élaguée après merge #49).

### Phases suivantes (non démarrées)
- **Phase 2** — Outils Gmail / Calendar / Drive (LECTURE) pour l'admin.
- **Phase 3** — Outils d'ACTION admin (relancer, assigner, planifier, valider/envoyer rapport) avec confirmation obligatoire.
- **Phase 4** — Assistant technicien (boîte restreinte à SES interventions + SON agenda ; connexion Google PAR UTILISATEUR à créer).
- **Phase 5** — Assistant portail (cloisonné par acteur syndic/courtier/expert + analytics doc 06).

## À faire (dans l'ordre) — mis à jour 2026-06-06
1. Assistant IA agentique — Phase 2 (outils Gmail / Calendar / Drive en lecture pour l'admin).
2. Walkthrough portails partenaires (syndic / courtier / expert) — audit par clics.
- (Backlog) Notif-retard technicien (portail Tech mobile) : bouton qui génère le message et ouvre la messagerie native du tech (deep link `sms:?body=` ou `wa.me/<num>?text=`) pré-rempli avec le n° de l'occupant. Contourne l'absence de credentials Twilio prod. Bon candidat pour une session courte.

---

# État du projet FoxO — snapshot 2026-06-06

- Date du recap : 2026-06-06
- HEAD git : cedf1f4 (merge PR #45)
- Branche : main, working tree propre
- Production : déployée par Vercel sur push main

## Chantiers clos depuis le snapshot 2026-05-29

- PR #43 (fix/hub-urgents-annulee, commit 667e3c0) : hub/page.tsx filtrait le statut "annulee" (hors enum intervention_statut) -> requete rejetee par Postgres -> badge "urgents" du hub bloque a 0. Fix : (cloturee) seul.
- PR #44 (feat/dashboard-tunnel) : refonte Dashboard "tunnel". 4 compteurs cliquables [Mails a traiter -> /admin/mails ; Nouvelles demandes -> ?statut=nouvelle ; A relancer -> ?statut=a_relancer ; Rapports a valider -> /admin/validation]. Alias UI a_relancer (= attente OU en_suspens) ajoute dans statutMatches (commit 61a1059). Retraits : briefing (rendu + getBriefing()), banniere urgents, cartes En cours/Clotures/En suspens. Compteur mails non lus = fetch client /api/admin/mails/unread-count. briefingText rendu optionnel (vestigial, non purge).
- PR #45 (feat/relance-ligne, commit 156642f) : bouton "Relancer" occupants par ligne dans src/app/admin/InterventionsClient.tsx (+102/-2). Icone Send par ligne, visible si statut dans {nouvelle, attente, confirmee, en_suspens}, confirmation inline obligatoire. Clic -> GET /api/admin/occupants/[id] puis POST /api/admin/interventions/[id]/notify-occupants avec occupant_ids. ATTENTION : notify-occupants exige occupant_ids non vide (sinon 400). DEJA EN PRODUCTION.

## Corrections de backlog perime (issu des sections historiques ci-dessous)

- clamp 500 batchModifyMails -> RESOLU (PR #41).
- feat/file-validation -> MERGE (PR #40).
- agent briefing -> identifie (src/lib/assistant/briefing.ts, instrumente runAgent, sain ; juste absent des fiches agents doc 03).
- TODO Dashboard BriefingIA -> caduc, le briefing a ete retire du dashboard (PR #44).

## Reperes techniques confirmes

- InterventionsClient.tsx est dans src/app/admin/ (PAS dans ./components/ ni src/components/).
- Deux repertoires de composants : ./components/ (racine, ex. Sidebar.tsx nav admin) ET src/components/. Alias @components/* -> racine.
- Enum Postgres intervention_statut (NON versionne dans db/migrations/), 7 valeurs : nouvelle, attente, confirmee, realisee, rapport, cloturee, en_suspens. "en_cours" et "a_relancer" = alias UI, jamais des valeurs DB.
- Portail partenaire unique auto-adaptatif /portal ; /portal/syndic + /portal/courtier = alias.

## A faire (dans l'ordre)

1. L'Assistant (/admin/assistant) "ne fonctionne pas" : chantier dedie, audit d'abord. Doit faire ce que Claude fait + acces Gmail/Calendar/Drive + plateforme FoxO.
2. Walkthrough portails partenaires (syndic/courtier/expert) : audit par clics de Foxo.

## Vigilance / dette

- briefingText vestigial (champ optionnel inerte dans DashboardData) — purge optionnelle.
- batchDeletePermanently (gmail.ts) non audite (possible limite 500 comme batchModify).
- analyse_pj peu declenche — valider sur un vrai cas PJ.
- Bruit Netlify deploy-preview sur chaque PR (non bloquant ; prod = Vercel).
- Twilio prod : SMS/WhatsApp occupants en attente de credentials.
- send.foxo.be Resend : statut DNS a verifier.

---

## Snapshot 2026-06-04 (soir) — PR #28 + #29 + #30

- **HEAD git** : `ee7ce09` (merge PR #30) · **Branche** : `main` · **Status** : clean

### PR #28 — Fix messages expert (`feat/revisite-expert-messages`, merge `24754ef`)
- Problème : l'org type `expert` retombait silencieusement sur `auteur_type='syndic'` (mapping `resolveCaller` ne traitait que `courtier`). Message d'expert mal étiqueté en base, indistinguable d'un syndic.
- Fix bout en bout :
  - Migration `2026-06-04_extend_messages_auteur_type_expert.sql` (idempotente) : CHECK `auteur_type` + index partiel `idx_messages_unread_admin` + RLS `syndic_insert_messages` élargis à `'expert'`.
  - Route `/api/messages` : `resolveCaller` mappe `expert`/`courtier`/`syndic` distinctement.
  - `MessagesPanel` : la bulle affiche le **rôle** (FoxO / Syndic / Courtier / Expert) au lieu du préfixe email ; email conservé en tooltip.
  - Badge non-lus **admin** : les requêtes (`admin/page.tsx` + `hub/page.tsx`) filtraient `auteur_type in ('syndic','courtier')` et **ignoraient les messages d'expert** ; `'expert'` ajouté → ils comptent désormais dans le badge 💬 admin.
- ✅ Migration **appliquée en prod le 2026-06-04** (insert expert OK sur le CHECK). Rows historiques experts déjà enregistrés `'syndic'` non rétro-corrigés.

### PR #29 — Bouton « Demander une suite / révision » (`feat/portal-demande-suite`, merge `d0c4d33`)
- Portail détail intervention : Block dédié (entre Rapport et messagerie) visible uniquement si `hasReport` (statut `rapport` ou `cloturee`).
- Action : POST d'un message pré-formaté vers `/api/messages` (réutilise l'infra PR #28). **Zéro migration, zéro nouvel endpoint.**
- UX : état `idle→sending→sent`, confirmation inline. Limite assumée : pas de flag « déjà demandé » (le bouton réapparaît au reload, trace dans le fil).

### PR #30 — Fix data gap assuré (`fix/assure-nom-data-gap`, merge `ee7ce09`)
- Clôt le backlog documenté au snapshot PR #23. Option A (JSONB, **aucune migration**).
- Type `interventions.assureur` : nouveau champ `assure`.
- `submitRequest` : capture **toujours** `assure_nom` dans le JSONB pour courtier ET expert (même sans réf compagnie / sans `dossiers_sinistres`) → plus jamais perdu.
- Liste portail : `isSinistre` (courtier OU expert) ; `acp_nom` priorise `assureur.assure` (JSONB) puis fallback `dossiers_sinistres`. Détail : champ « Assuré » ajouté au bloc Assurance.
- ⚠️ **Rows historiques** : interventions expert antérieures (sans dossier ni `assure` JSONB) **restent `—`** — non rétro-corrigeables. Seules les **nouvelles** demandes sont couvertes ; courtiers legacy gardent le fallback `dossiers_sinistres.assure`.
- ✅ Backlog « data gap assuré » (snapshot PR #23) → **RÉSOLU par #30**.

### Smoke-test en attente
- **BriefingIA (PR #26)** : rendu visuel + qualité texte Claude non vérifiés en runtime (pas d'`ANTHROPIC_API_KEY` en container). À valider sur Vercel Preview / local.

### Backlog ouvert
- Badge non-lus **côté portail partenaire** : inexistant (le partenaire ne voit pas de compteur dans sa liste) — chantier futur.
- `InterventionsPortalClient` : `isCourtier` strict pour accent/placeholder — cosmétique, non bloquant.

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

**✅ Appliquée en prod le 2026-06-04** : `2026-06-04_extend_agent_name_briefing.sql` jouée ; les inserts `agent_logs` du briefing passent le CHECK. Idempotente.

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

### Chantier — Étape 2 : Envoi demandes de confirmation occupants — clos le 2026-06-06
- Helper partagé `src/lib/occupants/notify-occupants.ts` extrait et branché best-effort dans `confirm-and-create`.
- Cible occupants `token_sent_at IS NULL`, idempotent, try/catch jamais bloquant.
- Email OK par défaut ; SMS/WhatsApp nécessitent credentials Twilio prod.
- Pas de migration SQL.
- PR #37 mergée main.

### Chantier — Étape 3 : Rapport validation & transmission — clos le 2026-06-06
Cycle de statut : brouillon → valide → transmis.
- `publishRapport` (tech) → brouillon, plus d'envoi auto (`6bc77cd`)
- `validateRapport` (admin) → valide + `valide_par` (auth.users.id) / `valide_at` (`7866038`)
- dispatch → transmis + `transmis_at` / `transmis_a` + URLs/IDs Drive capturés (`84194f6`)
- Drawer admin : route API `/api/admin/rapports/[intervention_id]` (`bc2b1e2`) + badges/boutons séquentiels (`bdfddca`)
- File `/admin/validation` + badge nav : rebranchés sur `rapports.statut IN ('brouillon','valide')`, transmis exclu (`64d4b5c`)
- RLS : `intervention_rapport_publie()` teste `rapports.statut='transmis'` (SECURITY DEFINER, anti-récursion). Migration `2026-06-06`, appliquée prod (`cfc0187`). Ferme la fuite brouillon→syndic.
- Interface TS `Rapport` 7→17 champs + `StatutRapport` (`database.ts`).
- Migrations SQL appliquées prod : `2026-06-05_rapports_statut_validation_transmission.sql` + `2026-06-06_rapport_publie_via_statut_transmis.sql`.
Reste : Étape 4 (reply-in-thread « rapport dispo »).

### Chantier — Étape 4 : Reply-in-thread Gmail « rapport dispo » — clos le 2026-06-06
- Déclenchement : dans `dispatchRapportToSyndic` (`src/lib/rapport/dispatch.ts`), bloc best-effort `try/catch` ajouté après l'envoi Resend — jamais bloquant.
- Garde : uniquement si `intervention.source === 'mail'` ET `source_mail_id` présent.
- Résolution thread : requête `mails_analyses.thread_id` où `dossier_match_id = interventionId` (évite l'incohérence thread_id/message_id de `source_mail_id`). Fallback : `source_mail_id`.
- Cible : `messages[0]` (premier message = demande d'origine du syndic) → garantit que `origFrom` = email syndic → bon destinataire.
- Corps : référence dossier (`built.ref`) + lien Drive (`pdfUp.web_view_link`), text/plain. PDF non joint (lien Drive suffit, `sendMailReply` text/plain only).
- Pas de migration SQL.
- Commits : `9694fb2` (feat) + `1bd71a7` (fix destinataire) + renommage cosmétique.

### Chantier — File de validation /admin/validation — clos le 2026-06-06
- Page `/admin/validation` centralisée : 5 sections (analyses mails, rapports, factures brouillon, notes de frais, interventions en suspens).
- `src/lib/admin/validation-queue.ts` : prédicats Supabase par source.
- Sidebar badge + mobile nav + hub chip.
- Fallbacks d'affichage (PR #40) :
  - Mails : sujet null → `(mail sans sujet)` ; `recu_le` null → fallback `created_at` (date d'analyse).
  - Factures : fallback polymorphe `organisation_id → organisations.nom` / `client_id → clients.prenom+nom` pour `client_nom` null.
- Validé en prod : mails affichent `(mail sans sujet)` + date ; factures restent `—` si aucun FK en base (données manquantes antérieures, comportement correct).
- PRs : intégré via PR #39 (Étape 3) + PR #40 (fix fallbacks).

### Chantier — Nettoyage système mails — clos le 2026-06-06
Audit complet : la majorité des items du backlog étaient déjà résolus.

**Propre à l'audit (rien à faire) :**
- `FOXO_TRAITE`/`FOXO_LU` : 1 seul commentaire documentaire dans `check-mails.ts:15`, aucun code actif.
- Clauses `-label:FOXO_*` dans la query cron : inexistantes, query = `'in:inbox is:unread'`.
- `classification` canonique (`categories.ts`) : en place de bout en bout (analyse-deep → colonne → UI), fallback `type` pour lignes historiques.

**Fix 1 — PR #41 — `batchModifyMails` chunking (gmail.ts + batch/route.ts) :**
- Troncature silencieuse à 500 IDs remplacée par une boucle de chunks séquentiels de 500.
- Type de retour étendu : `{ ok: true; processed: number } | { ok: false; error }` (additif).
- `batch/route.ts` retourne désormais `count: res.processed` (count réel, pas count d'entrée).

**Fix 2 — PR #42 — `analyse_pj` base64url → base64 standard (analyze-one.ts) :**
- Cause : Gmail encode les PJ en base64url (`-`/`_`), Anthropic attend du base64 standard RFC 4648 (`+`/`/`).
- 2 erreurs loggées dans `agent_logs` (intervention `5273c3f7`, 2026-05-18) — bug systématique sur toute PJ contenant `-` ou `_`.
- Fix : `Buffer.from(attachment.content_base64, 'base64url').toString('base64')` dans `analyze-one.ts` avant construction du mediaBlock (PDF + image). `gmail.ts`/`drive.ts` non touchés.

Note agent_logs : agent `briefing` présent (13 succès, dernier 2026-06-05) — non documenté dans les fiches agents, à identifier lors d'un prochain audit.

### Chantier "Reference syndic" — clos le 2026-06-06 (PR #52, merge commit)

Objectif : permettre au syndic de voir, chercher et saisir/modifier sa propre reference de dossier depuis le portail.

Decision cle : reutilisation de la colonne existante interventions.reference_externe (deja semantiquement "Ref. syndic", deja affichee ainsi dans le rapport via report-data-mapping.ts). AUCUNE migration SQL. Pas de colonne ref_syndic (doublon evite).
ATTENTION : doc 04 (schema) decrit a tort ref_syndic comme une colonne d'interventions — c'est reference_externe. Doc 04 a corriger.

Commits (branche feat/reference-syndic-portail, mergee via PR #52) :
- 8f1c6b8 liste : reference_externe expose (type InterventionPortalItem + mapping ; la page detail select('*') le transmettait deja)
- 8e767ba vocab : cle referenceLabel (syndic/courtier/expert), zero libelle en dur (doc 02)
- 41002ae liste : reference_externe cherchable (haystack, recherche cross-references doc 02) + affichee cote syndic, style calque sur la ligne BCE, mobile + desktop
- 454d306 action serveur updateReferenceExterne : ecriture bornee a l'appartenance (syndic_id = session.org.id, garde getCurrentSyndic, org.type==='syndic' requis, vide => null)
- 6db779f fiche detail : champ editable "Ma reference" (syndic only) cable via useTransition

Garanties : affichage + edition gates orgType==='syndic' ; un syndic ne modifie que ses propres dossiers (filtre syndic_id meme en service-role) ; tsc vert a chaque commit ; aucune migration. Valide end-to-end sur preview Vercel (saisie, persistance, affichage liste, recherche, effacement).

## 🗺 PLAN GLOBAL — Chantier "Création intervention multi-occupants depuis un mail"

- **Étape 1** ✅ FAIT — Création intervention depuis mail
  - **1.a** ✅ FAIT — Extraction occupants par Agent 1
  - **1.b** ✅ FAIT — UI `ConfirmCreateForm` liste éditable d'occupants (1.b.1 expose + 1.b.2 UI)
  - **1.c** ✅ FAIT — `confirm-and-create` persiste N occupants via `safeInsertOccupants`
- **Étape 2** ✅ FAIT — Envoi des demandes de confirmation aux occupants (mail Resend + SMS/WhatsApp Twilio)
- **Étape 3** ✅ FAIT — Rapport intervention (validation admin & transmission tracée : brouillon → valide → transmis)
- **Étape 4** ✅ FAIT — Réponse Gmail au mail initial du syndic (reply-in-thread : `In-Reply-To` + `References`, réutiliser `thread_id` + `message_id` déjà stockés)

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

### Chantier #9 — Suggestion de créneaux dans l'écran admin — clos le 2026-06-06

- Branche `feat/planning-suggestion-creneau`, mergée dans `main` via PR #46 (merge commit `c5bda72`).
- **Objectif** : exposer la logique `proposeCreneau()` (jusqu'ici branchée uniquement dans le pipeline `analyse-deep`) directement dans `/admin/planning`.
- **Livré** :
  - `src/lib/geo/geocode.ts` — helper `geocodeAddress` (Nominatim, bbox Belgique, best-effort → null si échec, aucune dépendance npm).
  - `src/app/admin/planning/actions.ts` — server action `proposeSlotForIntervention({ adresse, urgence })` → géocode puis `proposeCreneau`. Lecture seule (ne réserve rien). Garde `assertAdmin` ; retour neutre `{primary:null, alternative:null, fenetre_etendue:false}` si refus d'auth.
  - `src/app/admin/planning/ProposeSlotModal.tsx` — modal client (réutilise `ModalShell`/`ModalFooter`) : saisie adresse + toggle urgence, affichage `primary`/`alternative` + bandeau `fenetre_etendue`, états vides gérés.
  - `src/app/admin/planning/PlanningCalendar.tsx` — bouton « Proposer un créneau » (toujours visible) + state `showPropose` + `onSelect` → `setOpenModal({kind:'free', slot})` réutilisant le flux `CreateInterventionModal` existant.
- Aucune migration SQL. Aucune fonction existante modifiée. `tsc` vert (hook pre-push). Testé en Preview Vercel : bouton, suggestions, clic → fenêtre de création OK.
- Commits : `d3f148c`, `fb04b67`, `8f44110`, `e5976c9`.
- **Backlog laissé ouvert (non bloquant)** :
  - `createInterventionFromSlot` n'écrit toujours pas `lat`/`lng` sur l'intervention → le scoring géographique de `proposeCreneau` ne se nourrit pas encore de l'historique du planning. Amélioration future possible.
  - Logique Nominatim désormais dupliquée à 3 endroits (`autocomplete/route.ts`, `geocodeAddress` privé dans `analyse-deep`, nouveau `src/lib/geo/geocode.ts`) → consolidation DRY possible plus tard.

### Chantier #10 — Planifier en ligne (bouton par ligne) — clos le 2026-06-06

- Branche `feat/planifier-en-ligne`, mergée dans `main` via PR #47 (merge commit `a59d642`).
- **Objectif** : sur la liste des interventions, bouton « Planifier » par ligne (statut `nouvelle`, tableau desktop) → propose le meilleur créneau + technicien → assigne le tech et réserve le créneau, sans ouvrir le drawer.
- **Livré** :
  - `src/app/admin/PlanRowModal.tsx` — modal client (réutilise `ModalShell`/`ModalFooter`). Auto-propose au montage via `proposeSlotForIntervention` (adresse préremplie `iv.adresse` → repli adresse ACP ; urgence dérivée de `priorite === 'urgente'`). Sur sélection : `assignTechnician(id, technicien_id)` puis `PATCH /api/admin/interventions/[id]/schedule { date, heure, creneau_id }`. `router.refresh()` au succès.
  - `src/app/admin/InterventionsClient.tsx` — bouton « Planifier » (icône CalendarClock) dans la colonne d'action, condition `statut === 'nouvelle'`, `e.stopPropagation()` ; state `planningRow` + rendu `PlanRowModal`.
- **Vigilance « double chemin d'assignation » LEVÉE** : la route `PATCH /api/admin/interventions/[id]/assign` est du code mort (aucun appelant) ; chemin canonique = server action `assignTechnician` (`src/app/admin/actions.ts`). Réservation du créneau portée par `/schedule`.
- **Connu / backlog** : bouton desktop uniquement (la carte mobile est un `<button>` → imbriquer un `<button>` serait invalide ; refactor de la carte en `div role/onClick` requis pour l'action mobile). La route `/assign` morte pourrait être supprimée (nettoyage optionnel).
- Aucune migration SQL. Aucune fonction existante modifiée. `tsc` vert. Testé en Preview.
- Commits : `035a3d3`, `ff69b0c`.
