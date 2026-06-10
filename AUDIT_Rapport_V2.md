# AUDIT — Chantier « Rapport v2 »

État des lieux en **lecture seule** (aucun fichier de code modifié) en vue du chantier : fidélité au template Word, pipeline vision photos, cases techniques cochées.

- **Date** : 2026-06-10
- **Repo** : foxo-app — Next.js 16 App Router + Supabase
- **HEAD** : `9d38e73` (merge PR #70 « cycle rapport admin »), branche `main`, aligné `origin/main`.

---

## 1. Génération DOCX actuelle

**La génération ne part PAS du template Word** : le `.docx` est entièrement **reconstruit programmatiquement** avec la librairie `docx` (npm).

- **Fichier moteur** : `src/lib/rapport/build-docx.ts` — `import { … Packer, Document, … } from 'docx'` (l.14-32). Fonction publique **`buildRapportDocx(args)`** (l.524) → `new Document({...})` (l.665) → `Packer.toBuffer(doc)` (l.713). Renvoie un `Uint8Array`.
- **Données d'entrée** : un objet `ReportData` (mappé depuis la base par `src/lib/rapport/report-data-mapping.ts` : `buildObjet`, `buildFacturationLines`, `buildAdresseInterventionLine1/2`, `buildTechniques`, etc.), construit à partir de : `interventions`, `acps`, `organisations` (syndic), `utilisateurs` (tech), `occupants`, `observations_terrain`, et la table `rapports` (les 4 sections texte).
- **Photos** : `build-docx.ts` lit `photos_interventions` (`select drive_file_id, drive_url, filename, section, ordre, label`, l.426) et télécharge le binaire de chaque photo depuis Drive (`GET https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, l.370-375), puis l'intègre via `ImageRun`. **→ Le téléchargement serveur du binaire d'une photo Drive est déjà implémenté et fonctionnel** (cf. §3, faisabilité base64).

**Deux points d'entrée déclenchent la génération .docx :**
1. **`POST /api/admin/.../tech/rapport-docx`** (`src/app/api/tech/rapport-docx/route.ts`) — garde `tech || admin` (`roleForEmail` + `isAdminUser`). Construit le `.docx` (l.167) et l'**upload sur Google Drive** via `uploadRapport(...)` dans `RAPPORTS/{year}/{ref} {acp_nom}/`. Déclenché par le bouton **« Export Word »** de `RapportPanel.tsx` (sauvegarde le brouillon puis appelle la route).
2. **`dispatchRapportToSyndic`** (`src/lib/rapport/dispatch.ts:212-213`) — au moment de la **transmission**, génère le `.docx` (`await import('@/lib/rapport/build-docx')`) et l'upload sur Drive (version éditable archivée), en plus du PDF envoyé par email.

> ⚠️ Distinction importante : ce que reçoit le **syndic par email** est un **PDF** (`generateRapportPdf` via `@react-pdf`, `src/lib/rapport/dispatch.ts:buildRapportPdf` → `sendRapportEmail` pièce jointe). Le **`.docx`** n'est qu'une **version éditable archivée sur Drive**. `publishRapport` (tech) ne génère NI docx NI pdf — il pose seulement `rapports.statut='brouillon'` + `interventions.statut='rapport'`.

**Stockage du .docx produit** : Google Drive (`RAPPORTS/{année}/{ref} {adresse}/…docx`), id/URL persistés dans `rapports.docx_drive_url` / `docx_drive_file_id`. **Pas** dans Supabase Storage.

---

## 2. Agent rapport (rédaction des 4 sections)

**Point d'entrée** : `generateRapportSections(interventionId, brief)` dans `src/app/tech/interventions/[id]/generate-action.ts`.

- **Passe par `runAgent`** ✔ — `import { runAgent } from '@/lib/observability'` (l.9), appel `runAgent<RapportSections>({ … })` (l.227) qui wrappe `client.messages.create(...)` (l.247). Modèle **`claude-sonnet-4-6`** (l.11). `interventionId` connu d'entrée → tracé dans l'observabilité. `inputSummary` volontairement non-PII (longueurs de sections uniquement, l.265-284).
- **System prompt** : chargé depuis `src/lib/prompts/foxo-rapport.md` via `getFoxoSystemPrompt()` (`src/lib/prompts/rapport.ts`, lecture fichier + cache mémoire). **432 lignes.** C'est une **spécification COMPLÈTE de génération `.docx`** (stack Node `docx`, dimensions DXA, palette de couleurs, encadré de page, header/footer, tableau d'identification 5 lignes, 8 techniques en checkboxes ☑/☐, sections, photos, exemple de script Node). Extrait représentatif :

  ```
  # SYSTEM PROMPT — PLATEFORME FOXO RAPPORTS D'INTERVENTION
  ## Version 1.0 — Fox Group srl
  Tu es l'assistant de génération de rapports d'intervention pour Fox Group srl (FoxO)…
  ## 2. WORKFLOW AVANT GÉNÉRATION — OBLIGATOIRE
   1. Chercher dans Google Calendar l'événement correspondant…
   2. Chercher dans Gmail le thread du dossier…
   3. Croiser ces informations avec ce que l'utilisateur dicte
  ## 3. GÉNÉRATION DU FICHIER .DOCX  (Librairie: docx (npm), Output: /mnt/user-data/outputs/…)
  ## 8. … 8 techniques d'inspection (checkboxes ☑/☐) :
     Gauche : Capteur d'humidité / Thermographie infrarouge / Caméra endoscopique / Liquide traceur
     Droite : Détection acoustique / Test pression / Compteur / Gaz traceur / Inspection visuelle
  ## 9. SECTIONS DU CORPS : 1.DÉGÂTS 2.INSPECTION 3.CONCLUSION 4.RECOMMANDATION
  ```

  > ⚠️ **Décalage notable** : ce system prompt décrit la **génération du fichier Word** (et un workflow Calendar/Gmail), alors que l'agent ne doit produire que **4 sections de prose en JSON**. Le `userMessage` corrige ce décalage à la volée (voir ci-dessous), mais une grande partie du prompt (script Node, dimensions, extraction d'images, validate.py) est **hors-sujet** pour la tâche réelle et pollue le contexte.

- **Entrées exactes** (`userMessage`, l.199-216) : assemblage de
  1. `## CONTEXTE DOSSIER` = `buildContextSummary({ iv, acp, syndic, tech, occupants, observations })` — données de la base (réf, type, description, adresse, ACP, syndic, occupants, et **`observations_terrain`** : `test_type, etage, localisation, notes`).
  2. `## DICTÉE DU TECHNICIEN` = `trimmed` (le brief libre dicté/saisi par le tech).
  3. `## INSTRUCTIONS DE SORTIE` = override explicite : « UNIQUEMENT les 4 sections texte… Pas de génération .docx… Google Calendar et Gmail ne sont PAS disponibles ici… JSON pur, clés `degats, inspection, conclusion, recommandations` ».
  → **Donc : pas seulement la dictée** — le contexte dossier + les observations terrain sont injectés. **Aucune image n'est envoyée à l'agent** (pas de vision aujourd'hui).
- **Format de sortie** : **JSON pur** `{"degats","inspection","conclusion","recommandations"}` (parsé par `tryParseJson`, l.116).
- **Stockage du résultat** : l'action **renvoie** les sections au client ; elle **n'écrit pas** directement en base. C'est `RapportPanel` qui appelle ensuite `saveRapport`/`publishRapport` (`src/app/tech/actions.ts`) → upsert dans la table **`rapports`**, colonnes **`degats, inspection, conclusion, recommandations`** (+ `statut`). Une voie admin parallèle existe (`format=rapport_json` dans `src/app/api/admin/assistant/chat/route.ts` + `saveRapportDraftFromAdmin`).

---

## 3. Photos d'intervention

- **Stockage binaire** : **Google Drive** (dossier de l'intervention). Upload via `uploadPhoto` (`src/lib/google-drive.ts:254`) ; le fichier est rendu public (`makeFilePublic`) et son `webViewLink`/lien est stocké comme `drive_url`.
- **Table de référence** : **`public.photos_interventions`** (`db/migrations/2026-05-06_photos.sql` + `2026-05-28_photos_section.sql` + `2026-05-29_photos_label.sql`). Schéma exact :

  | Colonne | Type | Notes |
  |---|---|---|
  | `id` | uuid PK | `gen_random_uuid()` |
  | `intervention_id` | uuid FK → interventions | `on delete cascade` |
  | `drive_file_id` | text **not null** | id du fichier Drive |
  | `drive_url` | text **not null** | lien affichable (webViewLink) |
  | `filename` | text | |
  | `uploaded_at` | timestamptz | `default now()` |
  | `uploaded_by` | uuid FK → auth.users | |
  | `section` | text | check ∈ {degats, inspection, conclusion, recommandations} **ou null** (2026-05-28) |
  | `ordre` | integer | `default 0` (réordonnancement manuel, 2026-05-28) |
  | `label` | text | légende libre (2026-05-29) — **voir §4** |
  | `observation_id` | uuid | rattachement à une `observations_terrain` (panel observations) |

  RLS : `tech_insert_photos` / `tech_select_photos` (tech assigné), `admin_all_photos`.

- **Bug connu « previews cassées / `drive_url` »** : les vignettes s'appuient sur `drive_url` rendu directement (`<img src={drive_url}>`). Selon le mode d'upload/partage, le `webViewLink` Drive **n'est pas un lien d'image directe** (page de visualisation, pas le binaire) → l'`<img>` peut casser tant que `makeFilePublic` n'a pas réussi ou si l'URL n'est pas un lien `uc?export=view`. Côté **build-docx**, le contournement existe déjà : on **ne se fie pas à `drive_url`** mais on télécharge le binaire par `drive_file_id` (`?alt=media`, l.370). Le champ `drive_url` est donc fiable pour le `.docx` (via file_id) mais **pas garanti** pour l'`<img>` du portail — c'est l'origine des previews cassées.

- **Faisabilité download binaire serveur (base64 → Anthropic)** : **ÉLEVÉE — déjà prouvée**. `build-docx.ts:370-375` télécharge le binaire d'une photo côté serveur (`fetch files/{drive_file_id}?alt=media` + `arrayBuffer()`). Le même mécanisme alimente directement un `image` block Anthropic (`{ type:'image', source:{ type:'base64', media_type:'image/jpeg', data: base64 } }`). Pré-requis : token Google valide (déjà géré par `getValidAccessToken`) et conversion `.webp→.jpg`/redimension si besoin (les uploads tech sont surtout des photos JPEG ; le prompt mentionne déjà la conversion webp→jpg).

---

## 4. PWA technicien — upload photos

- **Composants** : `src/app/tech/interventions/[id]/PhotosPanel.tsx` (upload « libre » de photos) et `src/app/tech/interventions/[id]/ObservationsPanel.tsx` (observations terrain + photos rattachées à une observation).
- **PhotosPanel** : un seul déclencheur fichier (`<input type=file id="photo-input">` caché + `<label>` « Prendre des photos », l.262-274), upload multiple vers Drive, grille de vignettes (`<img src={p.url}>`). **Aucun champ légende/tag par photo.**
- **ObservationsPanel** : formulaire d'observation avec `test_type` (`<select>`, l.352), `etage` (input), `localisation` (input), `notes` (textarea), + photos attachées à l'observation (`observation_id`) et à une `section`. La photo hérite donc d'un **contexte** (type de test, localisation, section) mais **pas d'une légende individuelle saisie**.
- **Conclusion §4** : la colonne `photos_interventions.label` existe mais **n'est alimentée par aucun champ de saisie tech** dans ces panels (légende vide en pratique). → Pour le pipeline vision, il n'y a **pas** de caption humaine fiable par photo ; le seul signal structuré est `section` + (via observation) `test_type`/`localisation`.

---

## 5. Admin `/admin/validation` — état des 4 corrections (test 2026-000)

Toutes mergées (PR #68 sécurité + PR #70 cycle rapport admin) :

| # | Correction | État | Preuve |
|---|---|---|---|
| (a) | Wording trompeur `RapportPanel.tsx` ~l.232 | ✅ **Corrigé** | l.232 = « …enregistré en brouillon et soumis à validation… Aucune notification n'est envoyée au syndic ni aux occupants à ce stade. » |
| (b) | Fuites `dispatchRapportToSyndic` via `uploadInterventionDocument(kind='rapport')` et `updateInterventionStatus(→'rapport')` | ✅ **Corrigé** | `case 'rapport'` **retiré** de `notifyStatusChange` (0 occurrence dans `notifications.ts`) → passage en statut `rapport` ne transmet plus ; `updateInterventionStatus` désormais **gardé admin** (`if (!user||!isAdminUser()) return {error:'Accès refusé.'}`, l.49) |
| (c) | Affichage des 4 sections (au lieu des seules métadonnées) | ✅ **Corrigé (drawer)** | Panneau « Rapport au syndic » de `InterventionsClient.tsx` affiche les 4 sections + galerie photos (post #70). **Nuance** : la page `/admin/validation` elle-même reste une **file d'attente** (réf/ACP/statut) qui renvoie vers le drawer `/admin?id=` — c'est le drawer qui porte le contenu/édition/aperçu PDF. |
| (d) | Garde de statut sur `saveRapportDraftFromAdmin` | ✅ **Corrigé** | refus si statut ≠ brouillon : « Rapport déjà validé ou transmis — modification refusée. » |

> Acquis #70 supplémentaires : édition admin des 4 sections (brouillon), « Repasser en brouillon » (`reopenRapportDraft`), **Aperçu PDF** (`/api/admin/rapports/[id]/preview-pdf` réutilisant `buildRapportPdf`), **clôture auto** du dossier après transmission.

---

## 6. Schéma DB — contenu du rapport

**Table `public.rapports`** (1 ligne par intervention, FK `intervention_id`). Colonnes liées au contenu/état :

| Colonne | Type | Origine | Notes |
|---|---|---|---|
| `intervention_id` | uuid | (table d'origine, pré-migrations) | clé fonctionnelle (`onConflict`) |
| `degats` | text | pré-migrations | section 1 |
| `inspection` | text | pré-migrations | section 2 |
| `conclusion` | text | pré-migrations | section 3 |
| `recommandations` | text | pré-migrations | section 4 |
| `statut` | text **not null** | `2026-06-05` | check ∈ {`brouillon`,`valide`,`transmis`}, default `brouillon` |
| `valide_par` | uuid | `2026-06-05` | admin validateur |
| `valide_at` | timestamptz | `2026-06-05` | |
| `transmis_at` | timestamptz | `2026-06-05` | |
| `transmis_a` | text[] | `2026-06-05` | destinataires |
| `docx_drive_url` / `docx_drive_file_id` | text | `2026-06-05` | version Word éditable archivée |
| `pdf_drive_url` / `pdf_drive_file_id` | text | `2026-06-05` | PDF archivé |
| `genere_par_agent` | boolean not null default true | `2026-06-05` | traçabilité IA |
| `created_at` / `updated_at` | timestamptz | pré-migrations | |

- **Techniques cochées** : **pas de colonnes dédiées dans `rapports`**. Elles sont **dérivées** des `observations_terrain.test_type` au moment de la génération (`buildTechniques(observations)` dans `report-data-mapping.ts`), puis rendues en checkboxes ☑/☐ dans le docx. → Si on veut des cases « v2 » fiables et corrigeables par l'admin, il faudra soit persister l'état des 8 techniques, soit fiabiliser le mapping depuis `observations_terrain`.
- **RLS** : `rapports` est en `FORCE ROW LEVEL SECURITY` (migration `2026-05-11c`), policies admin/tech/partenaire.

---

## 7. Template `templates/FOXO TEMPLATE VIERGE.docx`

- **Présent dans le repo** ✅ (git-tracked). ⚠️ **Nom réel avec espaces** : `templates/FOXO TEMPLATE VIERGE.docx` (et non `FOXO_TEMPLATE_VIERGE.docx`).
- **Structure** (dézippé) : docx OOXML standard — `word/document.xml` (contenu), `word/styles.xml`, `word/header1.xml`, `word/footer1.xml`, `word/media/` (logo), `word/numbering.xml`, `word/settings.xml`, `word/fontTable.xml`.
- **Encodage des cases ☐ des techniques** : **caractère Unicode simple `☐` (U+2610 BALLOT BOX)** — **8 occurrences** dans `word/document.xml`. **Aucun content control Word** (zéro `w:sdt`, zéro `w14:checkbox`, zéro `FORMCHECKBOX`/`MERGEFIELD`). → Cocher une case = remplacer `☐` (U+2610) par `☑` (U+2611). **C'est exactement l'approche de `build-docx.ts`** (`checkItem(text, checked)` → `t(checked ? '☑  ' : '☐  ', …)`). Le template et la génération programmatique sont donc **cohérents** sur l'encodage des cases.
- **Techniques présentes dans le template** : Capteur (d'humidité), Thermographie infrarouge, Caméra endoscopique, Liquide traceur, Détection acoustique, Test pression, Gaz traceur, Inspection visuelle → **les mêmes 8** que le code.
- **Polices / styles** : **Calibri** (`w:ascii="Calibri"`, 44 occurrences dans `document.xml`, présent dans `styles.xml`) — unique police, conforme au system prompt (§3 palette : DARK_BLUE `1B3A5C`, MID_BLUE `2E75B6`, etc.).
- **Champs à remplir** : labels statiques (« N° Intervention », « Objet », « Adresse », « Techniques », titres de sections DÉGÂTS/INSPECTION/CONCLUSION/RECOMMANDATION). **Pas de placeholders type `{{ }}` ni de champs Word liés** → le template est une **référence visuelle (modèle vierge)**, pas un fichier à injecter par fusion. La génération reconstruit tout via la lib `docx`.

---

## Synthèse & implications pour « Rapport v2 »

1. **Fidélité au template** : le `.docx` est reconstruit en code (`build-docx.ts`), pas injecté depuis le `.docx` template. Le template (Calibri, cases `☐`/`☑` unicode, 8 techniques, 4 sections, palette) est **déjà reflété** dans le code. La « fidélité v2 » = comparer pixel/structure `build-docx.ts` ↔ `FOXO TEMPLATE VIERGE.docx` et combler les écarts (le code est la source de vérité, le template la référence visuelle).
2. **Pipeline vision photos** : **techniquement débloqué** — le download binaire serveur des photos Drive existe déjà (`?alt=media`), réutilisable pour envoyer des images base64 à `claude-sonnet-4-6` via `runAgent`. Manque : (a) injecter les images dans le `userMessage` de `generateRapportSections` (aujourd'hui texte seul), (b) pas de légende humaine par photo (seuls `section`/`test_type`/`localisation` disponibles).
3. **Cases techniques** : dérivées de `observations_terrain.test_type` (pas persistées dans `rapports`) → à fiabiliser/persister pour l'édition/validation admin.
4. **Prompt agent** : `foxo-rapport.md` (432 l.) est une spec docx largement **hors-sujet** pour la tâche « 4 sections JSON » ; le `userMessage` le corrige mais le contexte est pollué — candidat à un prompt v2 ciblé (rédaction + lecture d'images).
5. **Cycle admin** : les 4 corrections du test 2026-000 sont **toutes en place** (a/b/c/d), plus l'aperçu PDF fidèle et la clôture auto (#70).

---
*Audit réalisé en lecture seule le 2026-06-10 sur HEAD `9d38e73`. Aucun fichier de code applicatif modifié ; seul fichier ajouté : ce rapport.*
