# FoxO — État du projet

## 1. Identité

- **Date du recap** : 2026-05-11
- **HEAD git** : `c0df7b1e914f9df0c38546e4f4fcad7415d4dc20`
- **Branche** : `main`
- **Status** : clean (working tree propre)

### Dépendances clés (`package.json`)

| Paquet | Version | Rôle |
|---|---|---|
| `next` | 16.2.4 | Framework App Router (Turbopack, Cache Components) |
| `react` / `react-dom` | 19.2.4 | UI |
| `@supabase/ssr` | 0.10.2 | Client Supabase server/middleware |
| `@supabase/supabase-js` | 2.104.1 | Client Supabase admin (service-role) |
| `@anthropic-ai/sdk` | 0.91.1 | Assistant Claude + analyse mails |
| `resend` | 6.12.2 | Envoi email transactionnel (rapports / rappels / factures) |
| `docx` | 9.6.1 | Génération rapports Word côté serveur |
| `@react-pdf/renderer` | 4.5.1 | Rendu PDF factures |
| `qrcode` | 1.5.4 | EPC QR codes paiement SEPA |
| `leaflet` / `react-leaflet` | 1.9.4 / 5.0.0 | Carte des interventions (portail syndic) |
| `lucide-react` | 1.14.0 | Icônes UI |
| `image-size` | 2.0.2 | Inspection photos avant rapport |
| `tailwindcss` | 4 | CSS (design system FoxO) |

> ⚠️ **Pas de Twilio SDK installé.** L'envoi SMS/WhatsApp est encore en place via les variables d'env et `src/lib/sms.ts`, mais le module npm n'est pas dans `dependencies` — implémentation actuelle = fetch direct sur l'API REST Twilio.

---

## 2. Architecture

### Arborescence `src/app/` (niveau 2)

```
src/app/
├── admin/        # back-office FoxO (admin.foxo.be)
│   ├── alertes/  articles/  assistant/  clients/  comptabilite/
│   ├── courtiers/  experts/  facturation/  google/  hub/
│   ├── interventions/  mails/  metiers/  notes-frais/
│   ├── parametres/  planning/  sms/  syndics/  techniciens/
│   └── utilisateurs/
├── portal/       # portail clients (portal.foxo.be)
│   ├── courtier/  expert/  syndic/
│   ├── calendar/  interventions/  nouveau/
│   └── PortalContext.tsx · PortalNav.tsx
├── tech/         # app technicien terrain (tech.foxo.be)
│   ├── interventions/  historique/  notes-frais/
│   └── TechBottomNav.tsx
├── api/          # routes serveur (cf. §7)
├── auth/         # login OTP + logout (auth.foxo.be)
├── app-hub/      # landing app native (page + tile)
├── go-hub/       # landing redirections
├── o/[token]/    # lien public occupant (confirmation RDV par token)
└── rdv/          # prise de RDV public (RdvClient)
```

### Rôle des portails (3 lignes max chacun)

- **`admin/`** — Console interne FoxO. Gère interventions, planning, facturation, mails, SMS, paramètres Google/Twilio, comptes utilisateurs et assistant Claude.
- **`portal/`** — Portail clients B2B (syndic, courtier, expert). Tableau de bord intervention, carte ACP, calendrier, création de demandes — vocabulaire adapté via `vocabFor`.
- **`tech/`** — App mobile technicien (bottom-nav). Liste interventions du jour, RapportPanel pour saisir terrain + photos, export Word, notes de frais.
- **`auth/`** — Login OTP 6 chiffres (envoi via Gmail API → alias `info@foxo.be`) + logout. Single point d'entrée tous portails.
- **`o/[token]/`** — Page publique sans login : l'occupant confirme ou demande un autre créneau via token signé.
- **`rdv/`** — Prise de RDV public (formulaire externe avec rate-limit IP).

### Sous-domaines actifs

| Sous-domaine | Cible |
|---|---|
| `admin.foxo.be` | `/admin/*` |
| `portal.foxo.be` | `/portal/*` |
| `tech.foxo.be` | `/tech/*` |
| `auth.foxo.be` | `/auth/login` + `/api/auth/send-email` (Supabase Auth Hook) |
| `app.foxo.be` (ou racine) | `/app-hub` / `/go-hub` / `/o/[token]` / `/rdv` |

---

## 3. Modules fonctionnels (état réel)

| Module | État | Détails |
|---|---|---|
| **Auth OTP** | ✅ | Code 6 chiffres via **Gmail API** (pas OVH SMTP — alias `info@foxo.be` sur compte `foxotech1@gmail.com`). Endpoint webhook : `/api/auth/send-email` signé `SUPABASE_AUTH_HOOK_SECRET`. |
| **RLS Supabase** | ✅ (legacy dashboard) + 🚧 (nouvelles tables) | 9 tables coeur : `utilisateurs`, `organisations`, `delegues`, `interventions`, `acps`, `occupants`, `rapports`, `clients`, `photos_interventions`. RLS de la table `user_preferences` (2026-05-30) versionnée dans `db/migrations/`. Le reste vit dans le dashboard Supabase. |
| **Facturation — articles** | ✅ | CRUD articles via `/admin/articles`. |
| **Facturation — EPC QR** | ✅ | Génération QR SEPA via `qrcode` à l'impression PDF (`@react-pdf/renderer`). |
| **Facturation — import Beobank** | 🚧 | Module `comptabilite/` présent, parsing CSV à finaliser. Pas de rapprochement automatique transactions ↔ factures (cf. TODO `src/lib/ponto.ts`). |
| **Facturation — rappels** | ✅ | `/api/admin/facturation/send-rappel/[id]` + email Resend + log SMS. |
| **Rapports — génération .docx** | ✅ | `src/lib/rapport/build-docx.ts` (via `docx` lib) — modèle 2026-101, logo auto-ratio, photos colonne centrée. Fix logo largeur 200 (commit `e6868db`). |
| **Rapports — upload Drive** | ✅ | `createInterventionFolderFromMail` + `uploadAttachmentToFolder` dans `src/lib/drive.ts`. Dossier `RAPPORTS/2026/{ref Adresse}/`. |
| **Mails — pipeline → intervention** | ✅ | Cron `check-mails` lit Gmail, `analyse-deep` (Claude) extrait type + adresse + langue, `confirm-and-create` matérialise l'intervention + dossier Drive + créneau proposé. Form éditable avant création (commit `e2373a7`). |
| **Mails — actions 1-clic** | ✅ | Brouillon syndic (`draft-reply`), confirm occupant par mail/SMS, event Calendar. |
| **Portail syndic/courtier — `vocabFor`** | ✅ | `src/lib/portal/vocab.ts` adapte les libellés selon `OrgType` (syndic / courtier / expert). |
| **Portail — dashboard** | ✅ | Liste interventions filtrée `syndic_id` OU `organisation_id`, carte Leaflet pinned sur ACP. |
| **Portail — calendar** | ✅ | `/portal/calendar` — affichage interventions planifiées. |
| **App technicien — RapportPanel** | ✅ | Saisie observations terrain (`observations_terrain`) + photos labellisées + notes (`tech_notes`). |
| **App technicien — export Word** | ✅ | `/api/tech/rapport-docx` génère le `.docx` final côté serveur. |
| **Assistant Claude AI** | ✅ | `/admin/assistant` + drawer global. Route `/api/admin/assistant/chat` (Anthropic SDK direct). Contexte injecté via `src/lib/assistant/context.ts`. |
| **Google OAuth2 Drive/Gmail/Calendar** | ✅ | Flow `/api/google/auth` + `/callback`, tokens en table `google_tokens`, refresh auto dans `src/lib/google-auth.ts`. Calendar webhook + watch renewal (cron). |
| **Twilio SMS/WhatsApp** | 🚧 | Code prêt (`src/lib/sms.ts`, routes `/api/admin/sms/*`, logs en `sms_logs`), variables d'env définies dans `.env.example` mais **non valorisées dans `.env.local`**. SDK Twilio non installé (fetch REST direct). Cron `rappel-j1` insère en `sms_logs` mais n'envoie pas tant que credentials absents. |

---

## 4. ENV

### Présent dans `.env.local` (sans valeurs)

**Supabase**
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (vide)
- `SUPABASE_AUTH_HOOK_SECRET` (vide)

**Resend (notifications)**
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

**Anthropic (Claude)**
- `ANTHROPIC_API_KEY` (vide)

**Site**
- `NEXT_PUBLIC_SITE_URL` (vide)

### Documenté dans `.env.example` mais **absent de `.env.local`** (à provisionner)

**Cron Vercel**
- `CRON_SECRET`

**Twilio**
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `TWILIO_WHATSAPP_NUMBER`

**Google OAuth**
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_DRIVE_RAPPORTS_FOLDER_ID`
- `GOOGLE_DRIVE_FACTURES_FOLDER_ID`

**Site (compléments)**
- `NEXT_PUBLIC_APP_URL`

---

## 5. 20 derniers commits

```
c0df7b1 fix(auth/login): purge dark hardcoded hex + applique design system FoxO
e2373a7 feat(mails): editable form before dossier creation
0045e4d feat(mails): add confirm-and-create route with side-effects
4f680c9 refactor(mails): analyse-deep read-only + stronger address extraction + type_intervention
a3982d7 fix(mails): intervention type + robust geocoding fallback
9d01c3e fix(mails): robust JSON extraction for deep analysis
729fa4a docs: add Sprint Mails manual test checklist
e992895 feat(mails): add 1-click actions on analysed mails
4b20957 feat(api): add mail draft-reply, sms compose/send, calendar event routes
d554254 feat(api): POST /api/admin/mails/analyse-deep — pipeline mail → intervention
1ca0eb4 feat(drive): add generateNextRef + createInterventionFolderFromMail
2c826a3 refactor(drive): remove duplicate createInterventionFolder
842ffc4 chore(gitignore): track .env.example permanently
b9d890a chore: track .env.example with DRIVE_RAPPORT_FOLDER_ID
00fddb4 feat(drive): createInterventionFolder + uploadAttachmentToFolder pour pipeline mail
c5d1797 feat(mails): proposeCreneau — sélection slot optimal pour intervention
e6868db fix(rapport): logo header width 200 + retire debug log buildTechniques
8d84778 fix(rapport): logo auto-ratio + mapping correct + bordure de page conforme FOXO_BASE
b592217 fix(rapport): mapping ReportData — helpers partagés (objet/adresses/réf) selon modèle 2026-101
ac82358 fix(rapport): retirer section Observations terrain + photos en colonne centrée
```

---

## 6. TODOs ouverts

### TODO marqueurs dans le code (`// TODO` / `// FIXME` / `// HACK`)

- `src/lib/ponto.ts:35` — `TODO : OAuth2 client_credentials → token. Stocker en cache mémoire (TTL).`
- `src/lib/ponto.ts:42` — `TODO : récupère les transactions sur la fenêtre [from, to] et les matche` (rapprochement Beobank ↔ factures).
- `src/app/admin/Dashboard.tsx:14` — `TODO Sprint Brouillons IA + Briefing : réactiver BriefingIA`.

### Sprints non terminés (mémoire)

- **Sprint 6 — Notes de frais** : tables `notes_frais` + `notes_frais_comptable` créées (migrations 2026-05-06 / 2026-05-30), upload + extract route présents (`/api/tech/notes-frais/*`, `/api/admin/notes-frais/extract`), UI `/admin/notes-frais` + `/tech/notes-frais` en place. **À valider** : workflow complet de submission → validation comptable → export comptable.
- **Twilio config prod** : variables non valorisées en local, comptes Twilio à brancher pour activer les rappels J-1 SMS réels (le cron tourne, les rows `sms_logs` s'insèrent mais l'envoi est no-op).
- **Resend domain** : `RESEND_FROM_EMAIL=FoxO <noreply@foxo.be>` — vérifier que le domaine `foxo.be` est bien validé côté Resend (DKIM/SPF/DMARC) pour éviter le SPAM-folding.
- **Briefing IA / Brouillons IA** : désactivé dans `Dashboard.tsx`, à réactiver après stabilisation du pipeline mails.
- **Ponto / Beobank** : module créé, pas de token OAuth, pas de matching automatique. C'est le gros chantier facturation restant.

---

## 7. Routes API (arborescence simple)

```
src/app/api/
├── address/
│   └── autocomplete/route.ts
├── admin/
│   ├── acps/
│   │   ├── route.ts
│   │   └── [id]/route.ts
│   ├── assistant/chat/route.ts
│   ├── calendar/events/route.ts
│   ├── clients/[id]/route.ts
│   ├── facturation/send-rappel/[id]/route.ts
│   ├── facture/[id]/route.ts
│   ├── interventions/
│   │   ├── search/route.ts
│   │   └── [id]/
│   │       ├── route.ts
│   │       ├── accept-counter-proposal/route.ts
│   │       ├── apply-reanalysis/route.ts
│   │       ├── assign/route.ts
│   │       ├── color/route.ts
│   │       ├── confirm-mail/route.ts
│   │       ├── delete/route.ts
│   │       ├── historique/route.ts
│   │       ├── liens/route.ts
│   │       ├── lier/route.ts
│   │       ├── notify-occupants/route.ts
│   │       ├── reanalyze/route.ts
│   │       ├── recipients/route.ts
│   │       └── schedule/route.ts
│   ├── mails/
│   │   ├── route.ts
│   │   ├── analyse-deep/route.ts
│   │   ├── analyses/route.ts
│   │   ├── batch/route.ts
│   │   ├── confirm-and-create/route.ts
│   │   ├── draft-reply/route.ts
│   │   ├── labels/route.ts
│   │   ├── unread-count/route.ts
│   │   └── [id]/
│   │       ├── route.ts
│   │       ├── analyze/route.ts
│   │       ├── labels/route.ts
│   │       ├── mark-traite/route.ts
│   │       └── reply/route.ts
│   ├── notes-frais/extract/route.ts
│   ├── occupants/
│   │   ├── [id]/route.ts
│   │   └── manage/[occupant_id]/route.ts
│   ├── organisations/
│   │   ├── route.ts
│   │   └── [id]/route.ts
│   ├── parametres/planning-couleurs/route.ts
│   ├── planning/dispos/
│   │   ├── route.ts
│   │   ├── bulk/route.ts
│   │   └── resync/route.ts
│   ├── sms/
│   │   ├── compose/route.ts
│   │   └── send/route.ts
│   ├── societe/upload-logo/route.ts
│   ├── syndics/[org_id]/
│   │   ├── route.ts
│   │   ├── acps/route.ts
│   │   └── delegues/
│   │       ├── route.ts
│   │       └── [id]/
│   │           ├── route.ts
│   │           └── invite/route.ts
│   ├── techniciens/[id]/interventions/route.ts
│   ├── tech-summary/[id]/route.ts
│   └── utilisateurs/
│       ├── route.ts
│       └── [id]/route.ts
├── auth/send-email/route.ts
├── cron/
│   ├── check-mails/
│   │   ├── route.ts
│   │   └── preview/route.ts
│   ├── rappel-j1/
│   │   ├── route.ts
│   │   └── preview/route.ts
│   └── renew-calendar-watch/route.ts
├── facture/[id]/route.ts
├── google/
│   ├── auth/route.ts
│   ├── callback/route.ts
│   ├── calendar-events/route.ts
│   ├── calendar-import/route.ts
│   ├── calendar-sync/route.ts
│   ├── calendar-watch/
│   │   ├── subscribe/route.ts
│   │   └── unsubscribe/route.ts
│   ├── calendar-webhook/route.ts
│   └── test-drive/route.ts
├── messages/
│   ├── route.ts
│   └── [id]/lu/route.ts
├── rapport/[id]/route.ts
└── tech/
    ├── articles/route.ts
    ├── facture/
    │   ├── route.ts
    │   └── [id]/route.ts
    ├── interventions/[id]/notes/route.ts
    ├── notes-frais/
    │   ├── route.ts
    │   ├── upload/route.ts
    │   └── [id]/submit/route.ts
    ├── observations/
    │   ├── route.ts
    │   └── [id]/
    │       ├── route.ts
    │       └── photos/route.ts
    ├── photos/
    │   ├── route.ts
    │   └── [id]/route.ts
    ├── rapport-docx/route.ts
    └── upload-photo/route.ts
```
