# 🦊 FoxO — État du projet

_Dernière mise à jour : 2026-05-08 · `main` @ `7514a08`_

---

## Sprint Mails — tests manuels

Procédure de validation end-to-end du pipeline mail → action 1-clic
(routes T5-T6 + UI MailAnalyseActions). À exécuter sur un compte admin
réel avec Google connecté + ANTHROPIC_API_KEY + TWILIO_PHONE_NUMBER en
prod (ou env staging).

**Pré-requis prod** :
- Table `mails_analyses` créée avec colonnes `brouillon_gmail_id` +
  `event_calendar_id`.
- Colonne `interventions.drive_folder_id` créée.
- Dossier Google Drive `RAPPORTS/2026/` accessible par le compte OAuth
  FoxO (cf. `GOOGLE_DRIVE_RAPPORTS_FOLDER_ID`).

### Procédure

1. **Ouvrir `/admin/mails`.** Vérifier que les mails déjà analysés
   affichent les badges (TYPE coloré, LANGUE, URGENT, lien Dossier).
2. **Sélectionner 1 mail non analysé** (sans badge sous le snippet).
   Cliquer sur **`Analyser approfondi`** dans le panel détail (sous
   les boutons legacy).
   - Vérifier le spinner pendant 5-15s.
   - Vérifier le toast de succès.
   - Vérifier que les badges apparaissent dans la row + dans l'accordion.
3. **Si type='demande_intervention'** :
   - Vérifier qu'un nouveau dossier est créé dans `interventions` (badge
     "Dossier {ref}" apparaît).
   - Vérifier le dossier Drive créé sous `RAPPORTS/2026/{ref Adresse}/`.
   - Vérifier que les pièces jointes du thread sont uploadées dedans.
   - Vérifier que le créneau est proposé dans l'accordion détail.
4. **Tester `[Brouillon syndic]`** :
   - Cliquer sur le bouton, attendre toast "Brouillon créé".
   - Cliquer le lien "Ouvrir" → vérifier que le brouillon est dans
     Gmail web (`https://mail.google.com/mail/u/0/#drafts/...`).
   - Vérifier le contenu (signature `Christophe Mertens — FoxO`, langue
     correcte, date du créneau mentionnée).
5. **Tester `[Confirmer occupant ▼ → Par mail]`** :
   - Cliquer le dropdown, sélectionner "Par mail".
   - Vérifier le brouillon dans Gmail (langue + créneau + demande de
     confirmation).
6. **Tester `[Confirmer occupant ▼ → Par SMS]`** :
   - Cliquer le dropdown, sélectionner "Par SMS".
   - Vérifier l'ouverture de la modal avec téléphone + body pré-remplis
     par Claude.
   - Éditer si besoin, vérifier le compteur 160/segments.
   - Cliquer "Envoyer maintenant" → vérifier le SMS reçu sur le téléphone
     destinataire.
   - Vérifier la timeline de l'intervention (event `sms_envoye`).
7. **Tester `[Event Calendar]`** :
   - Cliquer le bouton, vérifier le confirm dialog avec date + heure +
     tech.
   - Confirmer → vérifier le toast "Event créé" + lien.
   - Vérifier l'event dans Google Calendar (date, heure, attendee tech).
   - Vérifier que le créneau passe `statut='reserve'` dans
     `creneaux_disponibles`.
   - Vérifier que l'intervention passe `statut='confirmee'` avec
     `creneau_debut` + `technicien_id` mis à jour.
   - Vérifier que le bouton devient "Event créé ✓" (disabled).
8. **Cas d'erreur à valider** :
   - Mail sans `occupant_telephone` → bouton SMS absent du dropdown.
   - Mail sans `dossier_match_id` → bouton "Brouillon syndic" absent.
   - Mail sans `creneau_propose_id` → boutons "Confirmer occupant" et
     "Event Calendar" absents.
   - Re-cliquer "Analyser approfondi" sur un mail déjà analysé → UPSERT
     idempotent (les colonnes `brouillon_gmail_id` et `event_calendar_id`
     sont préservées si présentes — vérifier qu'elles ne sont pas reset
     à null par une analyse répétée).

---

## 1. Repère

- **Branch** : `main` (synchronisée avec `origin/main`)
- **HEAD** : `7514a08 fix(vocab): Humidimètre→Capteur d'humidité, Mise en pression→Test de pression`
- **Working tree** : clean

---

## 2. Derniers commits (20)

```
7514a08 fix(vocab): Humidimètre→Capteur d'humidité, Mise en pression→Test de pression
ec16a9c feat(facturation): articles mis à jour si existant, mode édition, coordonnées client, email copie
abf5b78 feat(tech): retrait boutons Dicter + upload photo direct dans ObservationsPanel
685c6d3 feat(rapport): observations terrain dans Claude + .docx, labels photos, techniques dynamiques
a426464 feat(tech): ObservationsPanel — UI structurée test/étage/photos + GET photos observation_id
fb38e61 feat(tech): observations terrain — API CRUD + photos link + migration
164b62b feat(tech): rapport — légendes photos par section (label auto-save 800ms + aperçu)
133fb03 fix(tech): rapport — bouton dicter plus grand + auto-restart silence + sélection multiple photos
a772743 fix(tech): articles route — utiliser adminClient pour bypass RLS articles
f27f49a feat(tech): PaiementPanel — catalogue articles + PATCH ref client + GET /api/tech/articles
3ce24a1 feat(tech): sub-panels premium-card + section-label + emojis → Lucide + purge dark: orphelins
3f808a4 fix(portal): dossier_sinistre numero=iv.ref + select id,ref + log error
15144a9 fix(auth): delegues query .limit(1) avant maybeSingle pour multi-org
b6b3a2a fix(auth): titre login dynamique — Syndic/Courtier/Expert selon next param
799d116 fix(portal): refCompagnie optionnel expert — label + server action
c327b3e fix(portal): expert — accent ambre + refCompagnie optionnel
244f426 fix(portal): expert voit labels "Assuré" dans formulaire nouveau
9f835df feat(portal): expert peut créer une demande d'intervention
1f93885 feat(portal): routes /syndic /expert /courtier + hrefs app-hub
c94bf11 fix(app-hub): form espace client — position relative + dismiss au clic extérieur
```

---

## 3. Architecture générale

### Sous-domaines (mappés via `src/proxy.ts`)

| Host | Préfixe route | Auth | Description |
|---|---|---|---|
| `admin.foxo.be` | `/admin` | requise | Backoffice FoxO (interventions, facturation, etc.) |
| `tech.foxo.be` | `/tech` | requise | App PWA technicien (mobile-first) |
| `portal.foxo.be` | `/portal` | requise | Portail partenaires syndic/courtier/expert (auto-détecte orgType) |
| `auth.foxo.be` | `/auth` | publique | Login OTP magic link (titre dynamique selon `next` param) |
| `app.foxo.be` | `/app-hub` | publique | Landing publique tuiles partenaires + client + RDV |
| `go.foxo.be` | `/go-hub` | publique* | Pivot interne admin ↔ tech (force-static) |

\* `go-hub` techniquement public — l'auth se fait sur les sous-domaines cibles.

### Routes publiques (bypass-proxy)

- `/rdv` — landing RDV particulier (form 4 steps + calendar)
- `/o/[token]` — confirmation occupant via lien email

### Routes alias (redirect vers `/portal`)

- `/portal/syndic` — redirect → `/portal` (URL avec intent depuis app-hub)
- `/portal/expert` — redirect → `/portal`
- `/portal/courtier` — redirect → `/portal`

---

## 4. Modules actifs

### Admin (`src/app/admin/`)

| Module | Route | Statut |
|---|---|---|
| Layout + Topbar | `/admin/*` | ✅ |
| Tableau de bord (Dashboard premium) | `/admin` | ✅ KPI cards, bannière, mail rows, todo headers |
| Launcher home | `/admin/home` | ✅ icon-box teinté |
| Hub interne | `/admin/hub` | ✅ badges urgents/factures/messages |
| Pipeline interventions | `/admin/interventions/[id]` | ✅ drawer 5 onglets |
| Alertes | `/admin/alertes` | ✅ |
| Planning | `/admin/planning` | ✅ |
| Techniciens | `/admin/techniciens` | ✅ |
| Assistant IA | `/admin/assistant` | ✅ Claude conversationnel |
| **Partenaires** (sidebar dépliable) | | |
| ↳ Syndics | `/admin/syndics` | ✅ |
| ↳ Courtiers | `/admin/courtiers` | ✅ |
| ↳ Experts | `/admin/experts` | ✅ |
| ↳ Métiers | `/admin/metiers` | ✅ |
| Clients | `/admin/clients` | ✅ CRUD ACP/particulier/entreprise |
| **Comptabilité** | `/admin/comptabilite` → `/admin/facturation` | ✅ |
| ↳ Factures | `/admin/facturation` | ✅ |
| ↳ Devis | `/admin/facturation/devis` | ✅ |
| ↳ Notes de crédit | `/admin/facturation/notes-credit` | ✅ |
| ↳ Notes de frais | `/admin/notes-frais` | ✅ catégories comptables BE |
| ↳ Paiements | `/admin/facturation/paiements` | ✅ |
| ↳ Rappels | `/admin/facturation/rappels` | ✅ auto + manuel + groupé |
| ↳ Catalogue articles | `/admin/articles` | ✅ |
| ↳ Export comptable | `/admin/facturation/export` | ✅ Yuki CSV |
| Mails Gmail | `/admin/mails` | ✅ inbox + analyse IA |
| Utilisateurs partenaires | `/admin/utilisateurs` | ✅ |
| Paramètres | `/admin/parametres` | ✅ sidebar nav 12 sections + recherche debounced |
| Google OAuth | `/admin/google` | ✅ Drive + Gmail + Calendar |

### Tech (`src/app/tech/`)

| Path | Route | Statut |
|---|---|---|
| Layout (logo blanc + topbar) | `/tech/*` | ✅ |
| Accueil missions | `/tech` | ✅ refonte premium accent vert (#34D399) |
| Intervention détail (page principale) | `/tech/interventions/[id]` | ✅ refonte premium + Block premium |
| ↳ TimerPanel (chronométrage) | (sub-panel) | ✅ premium-card + section-label + Play/Square Lucide |
| ↳ PhotosPanel (terrain libres) | (sub-panel) | ✅ premium-card + IndexedDB queue offline |
| ↳ NotesPanel (auto-save 2s) | (sub-panel) | ✅ premium-card + dark: classes purgées |
| ↳ **ObservationsPanel** (tests structurés) | (sub-panel) | ✅ test_type + étage/loc + notes + photos liées |
| ↳ RapportPanel (4 sections + IA) | (sub-panel) | ✅ brief Claude + dictée silencieuse + auto-save 30s + labels photos par section |
| ↳ PaiementPanel (catalogue + QR EPC) | (sub-panel) | ✅ catalogue articles +/- + mode édition + coordonnées client |
| Historique missions | `/tech/historique` | ✅ refonte premium (filtres, recherche, MissionCard) |
| Notes de frais (form + upload + soumettre) | `/tech/notes-frais` | ✅ refonte premium inputs |
| Bottom nav PWA | (composant) | ✅ accent vert + dot indicator |

### Portal partenaires (`src/app/portal/`)

| Path | Route | Statut |
|---|---|---|
| Layout (auto-détecte orgType) | `/portal/*` | ✅ syndic / courtier / expert |
| PortalNav (sidebar + bottom nav iOS) | (composant) | ✅ navy gradient + border-left actif bleu |
| PortalContext (provider orgType + vocab) | (composant) | ✅ étendu à `'syndic' \| 'courtier' \| 'expert'` |
| Dashboard | `/portal` | ✅ refonte premium (KPI cards par type) |
| Liste interventions | `/portal/interventions` | ✅ filtres + recherche |
| Drawer dossier | `/portal/interventions/[id]` | ✅ |
| Création demande | `/portal/nouveau` | ✅ ouverte aux 3 orgTypes (Stratégie A) |
| Calendrier | `/portal/calendar` | ✅ |
| Routes alias `/portal/{syndic,expert,courtier}` | redirect | ✅ → `/portal` |

### Public

| Path | Route | Statut |
|---|---|---|
| RDV particulier | `/rdv` | ✅ refonte CSS vars (theming foxo-blue) |
| Confirmation occupant | `/o/[token]` | ✅ refonte CSS vars |
| Hub public | `/app-hub` (via app.foxo.be) | ✅ glass premium navy + 5 tuiles |
| Hub interne | `/go-hub` (via go.foxo.be) | ✅ glass premium navy + 2 tuiles admin/tech |

### Auth (`src/app/auth/`)

| Path | Route | Statut |
|---|---|---|
| Login OTP | `/auth/login` | ✅ titre dynamique (Syndic/Courtier/Expert/Partenaires) selon `?next=...` |
| Callback | `/auth/callback` | ✅ |
| Logout | `/auth/logout` | ✅ POST |

### API (`src/app/api/`)

| Module | Path | Notes |
|---|---|---|
| Admin ACPs | `admin/acps/[id]/` + `route.ts` | GET single + POST création |
| Admin clients | `admin/clients/` | CRUD |
| Admin facturation | `admin/facturation/` + `admin/facture/[id]/` | PDF + envoi rappel |
| Admin interventions | `admin/interventions/[id]/` | reanalyze, color, notify-occupants |
| Admin mails Gmail | `admin/mails/` | List, label, inbox, unread |
| Admin notes-frais | `admin/notes-frais/extract/` | OCR Claude vision |
| Admin occupants | `admin/occupants/` | CRUD |
| Admin organisations | `admin/organisations/` | CRUD 10 types |
| Admin paramètres | `admin/parametres/` | KV + planning-couleurs |
| Admin planning | `admin/planning/` | Créneaux dispo |
| Admin société | `admin/societe/upload-logo` | Storage `societe-assets` |
| Admin syndics | `admin/syndics/[org_id]/` | délégués + ACPs |
| Admin techniciens | `admin/techniciens/` | CRUD techs |
| Admin utilisateurs | `admin/utilisateurs/` | CRUD partenaires |
| **Tech articles** | `tech/articles` | GET catalogue actif (admin client bypass RLS) |
| **Tech facture POST** | `tech/facture` | Brouillon QR paiement + acceptation `articles[]` + update si existant brouillon |
| **Tech facture PATCH** | `tech/facture/[id]` | Update reference / client_nom / client_email / client_adresse / lignes (recalcul totaux) |
| **Tech observations CRUD** | `tech/observations` + `[id]` | GET/POST/PATCH/DELETE — auth tech + ownership |
| **Tech observations photos** | `tech/observations/[id]/photos` | POST link / DELETE unlink (double ownership check) |
| Tech notes-frais | `tech/notes-frais/` + `upload/` + `[id]/submit/` | GET/POST + upload + soumission |
| Tech rapport docx | `tech/rapport-docx` | Export Word HTTP blob (reçoit observations) |
| Tech upload-photo | `tech/upload-photo` | Drive + photos_interventions (FormData : file + intervention_id + section?) |
| Tech photos | `tech/photos/` + `[id]` | List + patch (label inclus) |
| Tech notes | `tech/interventions/[id]/notes` | Auto-save 2s |
| Cron | `cron/check-mails`, `cron/rappel-j1`, `cron/renew-calendar-watch` | Vercel Cron |

---

## 5. Sprints récemment terminés

### ✅ Sprint Vocab alignment Tech (commit 7514a08)

Renommage cohérent côté UI + API + .docx :
- `'Humidimètre'` → `"Capteur d'humidité"` (alignement avec doctrine FoxO + `TECHNIQUES_FOXO`)
- `'Mise en pression'` → `'Test de pression'`

Touche : `ObservationsPanel.tsx` (TestType + TEST_TYPES + ICON_BY_TYPE), `/api/tech/observations/route.ts` (ALLOWED_TEST_TYPES POST), `/api/tech/observations/[id]/route.ts` (ALLOWED_TEST_TYPES PATCH).

⚠ **SQL UPDATE à exécuter en prod** pour aligner les rows existantes (cf. §6 TODO 🔴).

### ✅ Sprint Facturation tech v2 (commit ec16a9c)

PaiementPanel évolué d'un mode lecture vers un éditeur complet :
- POST `/api/tech/facture` met à jour les lignes/montants si une facture brouillon existe pour l'intervention (au lieu de la retourner inchangée)
- Bouton "Modifier" en haut à droite de l'état C → reconstruit `selected` Map depuis `facture.lignes` (match `article_code` puis fallback `description`) → retour à la sélection
- PATCH `/api/tech/facture/[id]` étendu avec `client_nom`, `client_email`, `client_adresse`, `lignes` (recalcul totaux)
- Form "Informations de facturation" unifié dans l'état C : 4 inputs (référence + nom/société + adresse textarea + email copie) + 1 bouton Enregistrer

### ✅ Sprint Observations terrain (commits fb38e61 + a426464 + 685c6d3 + abf5b78)

Module structuré pour les tests/constatations menés sur site :
- **DB** : table `observations_terrain` (id, intervention_id, test_type, etage, localisation, notes, ordre, created_at) + colonne `photos_interventions.observation_id` FK ON DELETE SET NULL
- **API CRUD** : POST/GET/PATCH/DELETE + sub-route `/photos` pour POST link / DELETE unlink (double ownership check : photo et obs sur même intervention)
- **UI** : `ObservationsPanel.tsx` premium-card avec form (test_type select + étage + loc + notes + upload photo direct), cards par observation avec icône Lucide (Beaker/Gauge/Thermometer/Eye/Camera/Droplet/HelpCircle), badge étage·localisation, photos liées + picker de photos libres
- **Intégration rapport IA** : `generate-action.ts` charge les observations + les sérialise dans `buildContextSummary` pour Claude (5e bloc après occupants)
- **Intégration .docx** : `build-docx.ts` reçoit `observations` en arg, ajoute section "OBSERVATIONS TERRAIN" entre Inspection et Conclusion (table 3-cols 30/25/45 sans bordure : test_type bold / étage·loc / notes italic muted), `TECHNIQUES_FOXO` checkboxes cochées dynamiquement via `Set` matching
- **Auto-restart dictée RapportPanel** retiré (boutons Dicter supprimés du brief + sections), code SpeechRecognition conservé pour usage futur

### ✅ Sprint Sub-panels premium (commit 3ce24a1)

Refonte JSX des 4 sub-panels intervention tech :
- Wrapper `bg-cream border border-sand-border rounded-2xl p-4` → `premium-card`
- Headers `text-[10px] font-bold text-ink-muted uppercase tracking-widest` → `section-label`
- TimerPanel : emojis `▶`/`■` → `<Play>`/`<Square>` Lucide, `transition-opacity hover:opacity-90` sur boutons
- NotesPanel : 6 classes `dark:` orphelines purgées (le ThemeApplier CSS-vars gère désormais sans conflit)
- PaiementPanel + PhotosPanel : pareil

### ✅ Sprint Photos labels (commit 164b62b)

Légendes par photo (`photos_interventions.label`) :
- Migration `2026-05-29_photos_label.sql` (idempotent)
- API GET `/api/tech/photos` étendu, PATCH `/api/tech/photos/[id]` accepte `label?`
- RapportPanel : input texte sous chaque miniature (`text-[11px]` border sand) avec auto-save debounced 800ms via `labelTimersRef: useRef<Map<string, Timeout>>`
- PreviewModal + .docx affichent la légende italique muted sous chaque image

### ✅ Sprint Catalogue facturation tech (commit f27f49a)

Sélection d'articles avant génération facture :
- Migration `2026-04-29_facturation.sql` seedée avec 8 articles (DEP001 Déplacement / FOR001-005 forfaits / HEU001 Heures supp / RAP001 Rapport)
- API GET `/api/tech/articles` (admin client pour bypass RLS — `articles` policy = is_admin only)
- POST `/api/tech/facture` accepte `articles?: ArticleInput[]` (cap 50 + validation type-safe)
- PaiementPanel 3 états (sélection / loading / facture) avec cards +/- quantité, fallback "Passer sans article" pour mode legacy

### ✅ Sprint OrgType expert + routes alias (Stratégie A → B)

Mai 2026 — bascule progressive du portail unique auto-adaptatif vers une UX courtier-équivalent pour les experts.

**Phase 1 (Stratégie A — read-only)** : `OrgType` étendu à `'syndic' | 'courtier' | 'expert'`. Vocab expert avec `newRequestVerb: null` (lecture seule). Auto-détection dans `portal/layout.tsx` via `org.type`. CTAs masqués partout (sidebar, bottom nav, dashboard, liste interventions). Defensive redirect `/portal/nouveau → /portal` pour expert.

**Phase 2 (Routes alias)** : 3 sous-routes `/portal/{syndic,expert,courtier}` créées (server components → `redirect('/portal')`). Tiles app-hub mises à jour avec URLs porteuses d'intent.

**Phase 3 (Activation création expert)** : `newRequestVerb: '+ Confier une mission'` activé pour expert. Defensive redirect supprimé. Dans `NewRequestClient.tsx`, `isCourtier` → `isPartner` (`courtier || expert`). Accent ambre `#F59E0B` ajouté pour expert (CTA, accentBg, sidebar). `refCompagnie` rendu optionnel pour expert (label `(optionnel)` + skip validation server + skip dossiers_sinistres si vide).

**Phase 4 (UX login)** : `/auth/login` lit `searchParams.next` et adapte le label du portail (Syndic/Courtier/Expert/Partenaires). Cohérent avec le routing alias.

### ✅ Sprint Premium UI (admin / tech / portal / hubs)

Refonte design system complet : `.premium-card` + `.kpi-value` + `.section-label` + `.row-hover` + tokens `--text-primary/-2/-3` + accents par portail (`--accent-admin/-tech/-portal`).

- **Admin** : Dashboard refondu (KPI cards barre 3px par type, bannière urgences red premium, lignes mail accent ambre, todo headers palettes blue/green/amber). Launcher home avec icon-box teinté. Parametres sidebar 12 sections + recherche debounced + IntersectionObserver active tracking.
- **Tech** : Accueil avec header gradient sombre vert `#0d2318→#1a3d2a`, mission cards premium, heure split en accent vert. Bottom nav blanc + active dot indicator vert. Sous-pages historique + notes-frais + intervention detail refondues.
- **Portal** : Dashboard syndic premium accent bleu `#60A5FA`. PortalNav navy gradient `#0f1e35→#1a3a5c` + border-left actif bleu.
- **Hubs (app + go)** : Glass navy avec backdrop-blur, fadeInUp staggered animations, tuiles compactes Linear/Notion-style.

### ✅ Sprint Migration emojis → Lucide

`✓` `✕` `🗑` etc. → Lucide icons (`Check`, `X`, `Trash2`, etc.) sur ~40 fichiers, 3 sprints. Total ~494 emojis remplacés. 17 commits.

---

## 6. TODO / En cours

### 🔴 Priorité haute

- [ ] **SQL UPDATE vocab observations en prod** : exécuter dans Supabase SQL Editor pour aligner les rows existantes avec le commit `7514a08` :
  ```sql
  UPDATE observations_terrain SET test_type = 'Capteur d''humidité' WHERE test_type = 'Humidimètre';
  UPDATE observations_terrain SET test_type = 'Test de pression' WHERE test_type = 'Mise en pression';
  NOTIFY pgrst, 'reload schema';
  ```
- [ ] **Fix champ adresse `/rdv`** : champ adresse rendu en sombre (theme foxo-blue `var(--text)`) sur fond clair → texte illisible. Override CSS local ou propager le theme.
- [ ] **Documents téléchargeables portail syndic** : exposer rapports PDF/Word (depuis Drive ou direct depuis l'app) dans `/portal/interventions/[id]`. Aujourd'hui le syndic reçoit un email mais pas de download depuis le dashboard.
- [ ] **Portail Courtier réel** : aujourd'hui le vocab + l'UI sont en place mais aucune org `type='courtier'` testée end-to-end en prod. Créer une org de test + délégué, vérifier flux login → dashboard → création dossier sinistre → réception email.
- [ ] **Tester portail Expert end-to-end** : créer org `type='expert'` + délégué actif=true, login, vérifier UI complète (titre login dynamique, dashboard accent ambre, création dossier sans ref_compagnie).
- [ ] **Twilio SMS/WhatsApp** : env vars `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_WHATSAPP_NUMBER` à configurer Vercel. Tester envoi confirmation + rappel J1 + réception. Activer mode auto progressivement.
- [ ] **DNS Vercel `app.foxo.be` + `go.foxo.be`** : configurer les 2 sous-domaines dans le dashboard Vercel (Settings → Domains → Add) sinon le proxy ne reçoit pas les requêtes.
- [ ] **Migration `2026-05-27_messages.sql`** : vérifier qu'elle est appliquée en prod (table `messages` portal ↔ admin).
- [ ] **Migration `2026-05-06_notes_frais_comptable.sql`** : à appliquer pour activer `categorie_comptable` + `taux_deductibilite` + trigger BE.

### 🟠 Priorité moyenne

- [ ] **PaiementPanel — pré-remplissage `refValue`** : la branche existing du POST `/api/tech/facture` ne retourne pas `factures.reference`. Si une référence client a été sauvegardée précédemment et que le tech recharge la page, l'input apparaît vide alors que la valeur existe en DB. Ajouter `reference` au select et au response shape, pré-remplir `refValue` depuis `facture.reference`.
- [ ] **Auto-link client à la création facture** : aujourd'hui `organisation_id`, `client_nom`, `client_email`, `client_adresse` sont tous `null` à l'insert. Populater depuis `interventions.syndic_id` + ACP + organisation au moment du POST. Sinon la facture ne peut pas être envoyée automatiquement.
- [ ] **BBA dans QR EPC** : `QrPaiement` reçoit `numero` (ex. `FV2026-100`) et l'utilise comme communication, alors que `factures.reference_structuree` (BBA `+++NNN/NNNN/NNNNN+++` pour rapprochement bancaire automatique belge) est généré en DB mais jamais passé. Étendre POST response avec `reference_structuree`, prop QrPaiement, l'utiliser dans le payload EPC.
- [ ] **Bouton "✓ Paiement reçu"** : aujourd'hui le statut facture reste `brouillon` à vie côté tech. Ajouter dans état C de PaiementPanel un bouton qui appelle `PATCH /api/tech/facture/[id]` avec `{ statut: 'payee', date_paiement: today }`. Étendre la PATCH route pour accepter ces champs.
- [ ] **Notifications syndic à publication rapport (Twilio)** : à `publishRapport` server action, envoyer un SMS/WhatsApp via Twilio au délégué principal de l'organisation pour signaler la disponibilité du rapport. Lié au TODO Twilio config.
- [ ] **Templates factures/devis** : choix visuel (classique, moderne, minimaliste) dans Paramètres → Société. Aujourd'hui `react-pdf` rend un seul layout figé.
- [ ] **`foxo-rapport.md` cleanup** : réécrire comme system prompt pur (sans Skill stack Calendar/Gmail/scripts Node.js/`validate.py`/`pdftoppm`). Le prompt actuel est artefact d'une version précédente Claude Skill, le `userMessage` patche maladroitement avec "Google Calendar et Gmail ne sont PAS disponibles ici".
- [ ] **`Step1Courtier` rename → `Step1Partner`** : sémantiquement utilisé aussi par expert maintenant.
- [ ] **`getCurrentSyndic()` rename → `getCurrentOrgSession()`** : nom étroit alors que la fonction gère syndic + courtier + expert.
- [ ] **Hover desktop sidebar portal** : `.foxo-portal-desktop a:hover` reste en blanc cassé `#F0ECE4` — pourrait passer en accent bleu pour cohérence parfaite.
- [ ] **Mobile header portal** : `.foxo-portal-mobile-header` utilise encore `var(--sidebar-logo-bg)` (theme-driven) alors que la sidebar desktop passe en gradient navy hardcodé.
- [ ] **Sous-pages parametres** : 5 sections placeholder "Bientôt disponible" (IA, Documents, Notifications, Équipe & accès, Webhooks).
- [ ] **Topbar admin globale** : barre recherche globale + bouton "Nouvelle intervention".
- [ ] **Section "Actions rapides 2x2 glass"** sur tech accueil : mentionnée dans la spec étape Tech mais skip (pas de contenu défini).
- [ ] **Filtre query param sur InterventionsClient** : KPI cards passent `?statut=en_cours` mais `en_cours` est dérivé (= confirmee + realisee). Vérifier que `InterventionsClient.tsx` lit ce param et applique le filtre virtuel.
- [ ] **Expert sans `ref_compagnie`** : `assure_nom` est saisi côté UI mais non persisté en DB (dossiers_sinistres skip). Capturer dans `nom_facturation` ou champ dédié `intervention.assure_nom`.

### 🟢 Améliorations / dette technique

- [ ] **Numérotation `FV{year}-NNN` non atomique** : `lastNum + 1` dans POST `/api/tech/facture` n'est pas race-safe. 2 techs simultanés peuvent générer le même numéro. Postgres rejette le 2e via `numero unique`, mais l'erreur remonte côté client comme "Erreur facture" sans explication. Fix : fonction Postgres `generate_invoice_number(year, prefix)` SECURITY DEFINER avec `pg_advisory_xact_lock`.
- [ ] **Validation prix article côté serveur** : `validateArticles` côté API trust le `prix_htva` envoyé par le client. Un tech malveillant peut générer une facture à 0,01€. Re-fetcher l'article par `id` dans la base canonique et utiliser sa valeur.
- [ ] **Mode legacy "Détection de fuite hardcoded"** : avec le sprint catalogue, le mode legacy devrait disparaître ou rediriger vers `DEP001+FOR003`. Coexistence bug-prone.
- [ ] **`utilisateurs.organisation_id`** : colonne ajoutée par migration `2026-05-28_utilisateurs_organisation_id.sql` mais absente du type TS `Utilisateur`. Synchroniser.
- [ ] **`RoleUtilisateur` enum DB** : `'admin' | 'syndic' | 'courtier' | 'technicien'` — pas `'expert'`.
- [ ] **`DemandeurType` enum DB** : `'particulier' | 'syndic' | 'courtier'` — pas d'expert (mappé sur `'courtier'` server-side).
- [ ] **Schéma `organisations`, `acps`, `dossiers_sinistres`** non versionnés dans `db/migrations/` — récupérer via `pg_dump` Supabase et créer `0000_baseline.sql`.
- [ ] **Buckets Supabase Storage** `notes-frais-photos` + `societe-assets` : création manuelle requise.
- [ ] **Tooltip / aria-label** dans les pages refondues : vérifier que les boutons icon-only ont bien `aria-label`.
- [ ] **Test du redirect external** `redirect('https://auth.foxo.be')` dans `/go-hub/page.tsx` quand DNS pas configuré.
- [ ] **`react-hooks/refs`** désactivé sur `InterventionsClient.tsx` (~120 faux-positifs). Cleanup ponctuel si bug réel apparaît.
- [ ] **3 warnings `no-unused-vars`** à localiser via `npx eslint .`.
- [ ] **`MID_BLUE` / `DIVIDER`** jamais utilisés dans `src/lib/rapport/build-docx.ts` (`void` cast).
- [ ] **Server-side check `org.type === 'courtier'` sur insert dossiers_sinistres** : à tester en prod avec un cas réel.
- [ ] **Fonctions SpeechRecognition orphelines** dans RapportPanel.tsx : `startDictation` / `stopDictation` / `getRecognitionCtor` / `recognitionRef` / `activeDictationRef` / `useEffect` mirror et `rec.onend` auto-restart restent définis sans usage UI (boutons retirés au commit `abf5b78`). Conservés volontairement pour réintroduction future, mais ESLint peut warner.

### 💡 Idées / roadmap

- [ ] **Dashboard portail syndic — carte interactive (effet wow)** : carte de la zone du syndic avec marqueurs interventions (couleurs par statut), heatmap des fuites par immeuble, filtres temporels. Effet visuel premium pour différencier de la concurrence.
- [ ] **Logo société dans documents** : appliquer `parametres.societe_logo_url` dans factures PDF/DOCX + entête plateforme.
- [ ] **Améliorations Assistant IA** (`/admin/assistant` existe déjà) : mémoire conversationnelle persistante, intégration tools (chercher dans interventions, créer un brouillon de devis, etc.), historique des conversations.
- [ ] **Sidebar admin ordre personnalisable** : drag & drop, persistance dans `parametres.sidebar_order` ou `user_preferences`.
- [ ] **Multi-société** : actuellement `parametres.societe_*` est mono-tenant.
- [ ] **App tech UX dictée** : réintroduction avec bouton plus grand + feedback visuel pendant enregistrement. L'infrastructure SpeechRecognition (helpers, types, refs, fonctions, auto-restart silence) est conservée dans RapportPanel.tsx.
- [ ] **Messagerie email transactionnel** : Resend pour notifier admin/syndic des nouveaux messages.
- [ ] **Historique rappels multi** : `factures.rappels_history jsonb` avec timeline dans `/admin/facturation/[id]`.
- [ ] **Tuner `ACP_AUTO_THRESHOLD`** : actuellement `0.85` — évaluer faux-positifs sur 1 mois.
- [ ] **Vérif distorsion photos docx** : `image-size` intégré, à valider sur portrait/paysage extrêmes.
- [ ] **Champ `assure_nom` dédié sur `interventions`** : permettrait à l'expert de capturer le nom du client sans dépendre de la ref compagnie.
- [ ] **Webhook Resend pour bounces** : actuellement les bounces email ne sont pas trackés.
- [ ] **Notification push PWA tech** : nouvelle mission assignée → notif sur le téléphone.

---

## 7. Stack & versions

| Package | Version |
|---|---|
| `next` | `16.2.4` |
| `react` / `react-dom` | `19.2.4` |
| `typescript` | `^5` |
| `@supabase/ssr` | `^0.10.2` |
| `@supabase/supabase-js` | `^2.104.1` |
| `@anthropic-ai/sdk` | `^0.91.1` |
| `@react-pdf/renderer` | `^4.5.1` |
| `docx` | `^9.6.1` |
| `image-size` | `^2.0.2` |
| `qrcode` | `^1.5.4` |
| `resend` | `^6.12.2` |
| `next-themes` | `^0.4.6` |
| `tailwindcss` | `^4` |
| `lucide-react` | `1.14.0` |
| `eslint` | `^9` |

---

## 8. Système de thèmes

3 thèmes définis dans `src/lib/themes.ts` :

| Theme | Sidebar | Accent | Usage |
|---|---|---|---|
| `dark-amber` | `#1A1916` (sombre) | `#C8924A` (ambre) | défaut admin |
| `warm-light` | `#2C2118` (sombre) | `#D4862A` (orange) | défaut tech |
| `foxo-blue` | `#1B3A5C` (navy) | `#E8A020` (orange) | défaut portal + rdv + o/[token] |

CSS vars (`--card-bg`, `--text`, `--accent`, `--info-bg`, etc.) injectées dynamiquement par `ThemeApplier.tsx` via `usePathname()` + `portalDefaults`. Script blocking `<head>` (`THEME_INIT_SCRIPT`) évite le FOUC au 1er paint.

Tokens premium ajoutés en `:root` (cohérents avec theme system) :
`--page-bg`, `--card-radius`, `--card-shadow`, `--card-shadow-hover`, `--text-primary`, `--text-secondary`, `--text-muted`, `--accent-admin`, `--accent-tech`, `--accent-portal`.

### Accents par orgType (portal)

| Org type | Accent (CSS var + hex) |
|---|---|
| syndic | navy `#1B3A6B` |
| courtier | turquoise `#1D6FA4` |
| expert | ambre `#F59E0B` |

---

## 9. ENV vars

Actives en local (`.env.local`) :
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_AUTH_HOOK_SECRET`
- `ANTHROPIC_API_KEY`
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
- `NEXT_PUBLIC_SITE_URL`

À activer selon environnement (cf. `.env.example`) :
- `NEXT_PUBLIC_APP_URL`
- `CRON_SECRET`
- **`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_WHATSAPP_NUMBER`** ⚠ TODO priorité haute
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `GOOGLE_DRIVE_RAPPORTS_FOLDER_ID`, `GOOGLE_DRIVE_FACTURES_FOLDER_ID`
- `GOOGLE_CALENDAR_WEBHOOK_TOKEN`

---

## 10. Migrations DB

44 migrations dans `db/migrations/`. État présumé en prod :

**Migrations critiques à vérifier en prod** :
- `2026-04-29_facturation.sql` — tables factures + articles + parametres + RLS admin only + seed 8 articles
- `2026-05-06_notes_frais_comptable.sql` — enum + colonnes catégorie_comptable + trigger taux déductibilité belge ⚠ **TODO appliquer si pas déjà fait**
- `2026-05-16_facturation_params.sql` — paramètres facturation
- `2026-05-25b_factures_deleted_at.sql` — soft delete brouillons
- `2026-05-27_messages.sql` — table messages portal ↔ admin + RLS + helper SECURITY DEFINER ⚠ **TODO vérifier**
- `2026-05-28_utilisateurs_organisation_id.sql` — colonne `utilisateurs.organisation_id`
- `2026-05-28_photos_section.sql` — colonnes section + ordre sur photos_interventions
- `2026-05-29_occupant_types_extended.sql` — 8 valeurs type_occupant
- `2026-05-29_organisation_types_extended.sql` — ALTER TYPE pour 10 types orga (incluant `expert`)
- **`2026-05-29_photos_label.sql`** — colonne `label text` sur photos_interventions (idempotent, déjà appliquée en prod)
- **`2026-05-29_observations_terrain.sql`** — table `observations_terrain` + colonne `photos_interventions.observation_id` FK ON DELETE SET NULL (idempotent)
- `2026-05-30_user_preferences.sql` — préférence thème par user
- `2026-05-30_notes_frais.sql` — table notes_frais + RLS + trigger updated_at
- `2026-05-30_sync_acps_clients.sql` — FK + trigger sync acps→clients

**Buckets Supabase Storage à créer manuellement** :
```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES
  ('notes-frais-photos', 'notes-frais-photos', true, 5242880),
  ('societe-assets',     'societe-assets',     true, 2097152)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "public_read_notes_frais_photos"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'notes-frais-photos');
CREATE POLICY "public_read_societe_assets"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'societe-assets');
```

**Schémas hors versioning (dette technique)** :
- `organisations` (référencée dans 9 migrations ALTER mais pas de CREATE TABLE)
- `acps` (idem)
- `dossiers_sinistres` (totalement absente des migrations)
- `categorie_note_frais` enum (CREATE TYPE absent)
- `user_role` enum (CREATE TYPE absent — utilisé pour `utilisateurs.role` ET `organisations.type`)
- `DemandeurType` check/enum (absent — TS = `'particulier' | 'syndic' | 'courtier'`)

---

## 11. Auth & autorisation

### Whitelist (server-side, code dur)

`src/lib/auth/roles.ts` :
- `ADMIN_EMAILS` — liste hardcodée → `role = 'admin'` → routing `/admin`
- `TECH_EMAILS` — idem → `role = 'tech'` → routing `/tech`
- Tous les autres → `role = 'partner'` → routing `/portal` (auto-détection orgType via `getCurrentSyndic()`)

### Cascade auth portal (`src/lib/portal/syndic.ts`)

`getCurrentSyndic()` cherche en cascade :
1. `delegues` (lookup `email + actif=true` → join `organisations`) — supporte multi-org via `.limit(1).maybeSingle()` (commit `15144a9`)
2. `organisations.email` legacy fallback
3. Renvoie `{ user, org, role: 'admin' | 'delegue' | null, via: 'delegue' | 'legacy' | null }`

### Whitelist applicative `sendOtp` (`src/app/auth/login/actions.ts`)

3-tier gate avant envoi OTP :
1. ADMIN_EMAILS ∪ TECH_EMAILS hardcoded → bypass
2. `utilisateurs WHERE email AND actif=true` → autorisé
3. `delegues WHERE email AND actif=true` `.limit(1).maybeSingle()` → autorisé
4. Sinon → "Accès non autorisé. Contactez info@foxo.be."

### orgType (PortalContext)

```ts
const orgType: OrgType =
  org?.type === 'courtier' ? 'courtier' :
  org?.type === 'expert'   ? 'expert'   :
  'syndic';
```

Auto-détection dans `portal/layout.tsx`. Fallback `'syndic'` si org.type est autre chose (legacy `'assurance'`, `'plombier'`, etc. → traités comme syndic par défaut).

---

_Fichier maintenu manuellement à jour entre les sessions. Mettre à jour HEAD + dernière section commit + TODOs au fur et à mesure._
