# AUDIT DESIGN SYSTEM & ARCHITECTURE — FoxO

> Document de transmission. Audit documentaire de l'existant au commit `12a5261`
> (merge PR #141, branche main). Toutes les valeurs citées proviennent du code
> réel (fichiers sources indiqués). Aucune proposition d'amélioration.

---

## 1. Architecture générale

**Stack** (versions exactes de `package.json`) :

| Technologie | Version | Rôle |
|---|---|---|
| next | **16.2.4** | Framework — App Router exclusivement (`src/app/`) |
| react / react-dom | **19.2.4** | UI |
| typescript | ^5 | `strict: true` (tsconfig.json), `npm run typecheck` = `tsc --noEmit` |
| tailwindcss | ^4 | Via `@tailwindcss/postcss` (^4) — **aucun `tailwind.config`** : toute la config passe par `@theme` dans `src/app/globals.css` ; `postcss.config.mjs` ne contient que le plugin |
| @supabase/supabase-js | ^2.104.1 | DB + Auth |
| @supabase/ssr | ^0.10.2 | Clients Supabase SSR |
| lucide-react | ^1.14.0 | Icônes (seule bibliothèque d'icônes) |
| @react-pdf/renderer | ^4.5.1 | PDF factures (`src/lib/facturation/FactureFoxoPdf.tsx`) et rapports |
| docx | ^9.6.1 | Rapports DOCX (`src/lib/rapport/build-docx.ts`) |
| leaflet 1.9.4 + react-leaflet ^5.0.0 | Carte portail (`src/components/portal/SyndicMap.tsx`, import dynamique `ssr:false`) |
| qrcode ^1.5.4 | QR EPC paiement (`src/lib/facturation/epc-qr.ts`, `src/components/QrPaiement.tsx`) |
| resend ^6.12.2 | Emails transactionnels (`src/lib/email/resend.ts`, domaine send.foxo.be) |
| @anthropic-ai/sdk ^0.91.1 | Agents IA (toujours via `runAgent`, cf. §16) |
| image-size ^2.0.2 | Dimensions images (pipeline photos/rapport) |
| husky ^9.1.7 | Hooks git — le pre-push exécute `tsc --noEmit` |
| eslint ^9 + eslint-config-next 16.2.4 | Lint |

**Alias TypeScript** (tsconfig.json) : `@/*` → `./src/*` et `@components/*` → `./components/*`.
Il existe donc **deux dossiers composants** : `src/components/` (la majorité) et `components/`
à la racine (Sidebar admin + wrappers layout), importé via `@components/`.

**Structure de `src/`** (arborescence réelle, 3 niveaux) :

```
src/app/
  admin/            back-office (layout.tsx = garde isAdminUser + Sidebar + MainContent)
    alertes/ articles/ assistant/ clients/ comptabilite/ courtiers/ experts/
    facturation/ (dashboard, devis, notes-credit, achats, fournisseurs, paiements,
                  rappels, export, new, [id], regles) google/ hub/ interventions/
    mails/ metiers/ notes-frais/ observabilite/ parametres/ planning/ sms/
    syndics/ techniciens/ utilisateurs/ validation/
    + Dashboard.tsx, InterventionsClient.tsx, PhotoAnnotator.tsx… (gros clients de page)
  api/              route handlers (address, admin/**, auth, cron/**, facture,
                    google, messages, rapport, tech)
  portal/           portail partenaire unique auto-adaptatif (syndic/courtier/expert)
                    — /portal/syndic|courtier|expert = redirects vers /portal
                    (src/app/portal/syndic/page.tsx), + calendar, interventions, nouveau
  tech/             PWA technicien (layout avec manifest + TechBottomNav)
                    — assistant, historique, interventions/[id], notes-frais
  app-hub/ go-hub/  hubs de tuiles (public / interne) sur fond navy
  auth/ (login, logout)   o/[token] (portail occupant)   rdv/ (prise de RDV publique)
src/components/     composants partagés (cf. §13) + admin/ + layout/ + portal/ + ui/
src/hooks/          useMediaQuery.ts (unique hook)
src/lib/            logique métier : admin/ agents/ (analyse-pj, extraction-achat,
                    extraction-cas) assistant/ auth/ constants/ cron/ drive/ email/
                    facturation/ geo/ images/ mail/ mails/ notifications/
                    observability/ occupants/ pdf/ portal/ prompts/ rapport/
                    supabase/ (client.ts, server.ts, admin.ts) text/ types/
components/         Sidebar.tsx + layout/ (MainContent, MainContentTech)
```

**Organisation des composants** : pages = Server Components (`page.tsx`) qui fetchent
et passent les données à un gros composant client `XxxClient.tsx` colocalisé
(`'use client'`) ; les Server Actions vivent dans un `actions.ts` par domaine
(`'use server'`). Pas de bibliothèque de composants UI tierce — `src/components/ui/`
ne contient que `Skeleton.tsx` et `Accordion.tsx`.

---

## 2. Design System — palette complète

Source de vérité unique : `src/app/globals.css` — variables `:root` remappées en
tokens Tailwind v4 via `@theme` (utilisables en `bg-sand`, `text-ink`,
`border-sand-border`… ou en `var(--color-*)`). `color-scheme: light` ;
**mono-thème clair** : la variante `dark:` est neutralisée par
`@custom-variant dark (&:where(.dark, .dark *))` (classe `.dark` jamais posée →
les ~590 `dark:` résiduelles sont inertes).

| Token | Hex | Usage |
|---|---|---|
| `--color-sand` | `#F5F2EC` | fond de page |
| `--color-sand-mid` | `#EDE8DF` | fonds secondaires, skeletons, chips neutres |
| `--color-sand-border` | `#DDD8CC` | bordures |
| `--color-sand-hover` | `#F8F4EE` | hover de lignes |
| `--color-cream` | `#FDFBF7` | fond de carte |
| `--color-ink` | `#1C1A16` | texte principal |
| `--color-ink-mid` | `#6B6558` | texte secondaire |
| `--color-ink-muted` | `#A09A8E` | texte tertiaire, placeholders |
| `--color-navy` | `#1B3A6B` | **primaire** (boutons primary, liens, titres num.) |
| `--color-navy-dark` | `#152D54` | gradient sidebar (haut) |
| `--color-navy-deep` | `#0F2040` | gradient sidebar (bas), teinte des ombres |
| `--color-navy-mid` | `#2A5298` | focus border inputs |
| `--color-navy-light` | `#D6E4F7` | bordures accent |
| `--color-navy-pale` | `#EBF2FB` | fonds accent (badges, encarts) |
| `--color-sky-foxo` | `#A8D4E8` | item actif sidebar, gradient radial signature |
| `--color-sky-light-foxo` | `#E8F4FA` | fond bleu ciel clair |
| `--color-terra` | `#C4622D` | **erreur / alerte / destructif** |
| `--color-terra-light` | `#F7EDE5` | fond erreur |
| `--color-terra-mid` | `#E8C4AF` | bordure erreur |
| `--color-amber-foxo` | `#B8830A` | **avertissement**, badges compteurs sidebar |
| `--color-amber-light` | `#FBF3E0` | fond avertissement |
| `--color-ok` | `#1F6B45` | **succès** |
| `--color-ok-light` | `#E4F2EB` | fond succès |
| `--color-ok-mid` | `#B8D9C8` | bordure succès |
| `--accent-tech` | `#34D399` | accent vert du portail tech uniquement (bottom-nav, refs missions) — « pas un thème, juste une teinte d'accent » |

Couleurs hors tokens observées dans le code : `#A17244` (ambre-brun — bouton
« Enregistrer brouillon » de FactureEditor, « + Nouveau » client, TypeBadge
courtier), `#60A5FA` (item actif PortalNav), gradient portail `#0f1e35 → #1a3a5c`
(PortalNav.tsx), `#8A5A1A` / `#E8C896` (texte/bordure des badges sur fond
amber-light), badges NoteFrais `#7C3AED`/`#F5F3FF` (statut « Remboursée »,
commenté « pas de token FoxO existant pour ce cas »), tech bottom-nav
`#FFFFFF` / bordure `#E6E2DC` / inactif `#9A9690`.

---

## 3. Typographie

Cinq polices chargées via `next/font/google` dans `src/app/layout.tsx`
(`display: 'swap'`, variables CSS sur `<html>`) :

| Police | Variable | Graisses chargées | Usage |
|---|---|---|---|
| **DM Sans** | `--font-dm-sans` | 400, 500, 600, 700, 800 | `--font-sans` → **police par défaut du `<body>`** (globals.css : `font-family: var(--font-sans)`) |
| **DM Mono** | `--font-dm-mono` | 400, 500 | `--font-mono` → `font-mono` (numéros, BBA, montants, dates) |
| **Sora** | `--font-sora` | 300, 400, 500, 600, 700 | titres/chiffres/refs — classes `.font-sora` et échelle `.fxs-*` |
| **Inter** | `--font-inter` | 400, 500, 600 | body du « nouveau design system » via `.font-inter` |
| **Syne** | `--font-syne` | 500, 600, 700, 800 | display legacy via `.font-display` (letter-spacing −0.01em ; hubs) |

Body : **14px**, `-webkit-font-smoothing: antialiased`, fond sand, texte ink.

**Échelle de titres « D7 »** (globals.css, toutes en Sora 600) :

| Classe | Taille | letter-spacing | line-height | Rôle |
|---|---|---|---|---|
| `.fxs-page-title` | 1.5rem (24px) | −0.03em | 1 | h1 de page (couleur ink fixée ; les `<span>` internes héritent) |
| `.fxs-title-sm` | 1.25rem (20px) | −0.02em | 1.15 | h1 secondaires / états vides / PWA tech |
| `.fxs-section-title` | 0.9375rem (15px) | −0.01em | 1.3 | h2 de section |
| `.fxs-block-title` | 0.8125rem (13px) | 0 | 1.3 | h2/h3 intra-carte |

Classes legacy « premium » conservées : `.section-title` (Sora 12px 600,
letter-spacing 0.3px), `.section-label` (11px 500 uppercase, letter-spacing
0.12em, ink-mid), `.kpi-value` (Sora 28px 600, lh 1, −0.02em, tabular-nums),
`.stat-num` (tabular-nums).

**Chiffres tabulaires** : `table { font-variant-numeric: tabular-nums; }`
global ; hors tableau, utilitaire `tabular-nums` au callsite.

Tailles de travail observées dans les composants : libellés méta 10–11px
(`text-[10px]`, `text-[11px]`, uppercase tracking-wider), corps de tableau
12–13px (`text-[12px]`, `text-xs`), inputs 13px (`text-[13px]`), boutons
12–13px bold, PWA tech 14px (`text-[14px]`).

---

## 4. Espacements

Aucune échelle d'espacement formalisée au-delà de celle de Tailwind —
pratiques observées :

- **Gabarit admin** (`components/layout/MainContent.tsx`) : contenu dans
  `px-6 py-6` (24px), pleine largeur à droite d'une sidebar 220px.
- **Gabarit tech** (`components/layout/MainContentTech.tsx`) : `max-w-[640px]`
  centré, `padding: 16px` latéral, `padding-top: 16px`,
  `padding-bottom: calc(90px + env(safe-area-inset-bottom, 0px))` (réserve
  pour la bottom-nav).
- **En-tête de page admin** : `mb-6 pb-3.5 border-b border-[var(--color-sand-border)]`
  (pattern répété sur toutes les pages facturation/paramètres).
- **Cartes** : padding `p-4` (16px) ou `p-5` (20px) ; sections espacées par
  `space-y-3` à `space-y-5` ; grilles de formulaires `grid gap-3`
  (`grid-cols-1 sm:grid-cols-2` ou `sm:grid-cols-3`).
- **Cellules de tableau** : `px-3.5 py-2.5` (14px/10px) — listes denses.
- **Nav sidebar** : items `padding: 9px 12px`, `gap: 9`, `margin-bottom: 2px`
  (Sidebar.tsx, styles inline).

---

## 5. Boutons

**Aucun composant `<Button>` centralisé** — patterns répétés en classes
utilitaires (relevés dans FactureEditor.tsx, AchatsListClient.tsx,
FournisseursClient.tsx, PeppolActions.tsx…) :

| Variante | Classes types |
|---|---|
| Primaire | `bg-navy text-white px-3.5 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50 min-h-[40px]` (ou `px-4 py-2.5 text-[13px] min-h-[44px]`) |
| Secondaire | `bg-white text-navy border border-navy-light rounded-lg font-bold hover:bg-navy-pale` |
| Danger | `bg-white text-terra border border-terra-mid hover:bg-terra-light` ; destructif plein : `bg-terra text-white hover:opacity-90` |
| Brouillon/ambre | `bg-[#A17244] text-white hover:bg-[#8A613B]` (FactureEditor « Enregistrer brouillon ») |
| Neutre | `bg-sand-mid text-ink-mid border border-sand-border hover:bg-sand-hover` |
| Lien-action | `text-[11px] font-semibold text-navy hover:underline` (Éditer) / `text-terra` (Supprimer) |
| Chips filtres | `px-3 py-1.5 rounded-full text-[11px] font-bold border` — actif `bg-navy text-white border-navy`, inactif `bg-white text-ink-mid border-sand-border hover:border-navy-mid` |
| Désactivé explicatif | `bg-sand-mid text-ink-muted border border-sand-border cursor-not-allowed` + raison dans `title` (PeppolActions/OdooActions) |

- **Radius** : `rounded-lg` (0.5rem = 8px, aligné sur `--radius-ctl: 8px`) ;
  gros CTA mobile `rounded-xl`.
- **États** : hover = `hover:opacity-90` ou changement de fond ; désactivé =
  `disabled:opacity-50` (+ `disabled:cursor-not-allowed` sur certains) ;
  focus = anneau global (cf. §10) ; pas d'ombre par défaut sur les boutons.
- **Pending** : libellé remplacé par `…` ou `Envoi…` via `useTransition`.
- Cibles tactiles : `min-h-[40px]`→`min-h-[52px]` selon contexte (52px sur les
  CTA sticky mobile de FactureEditor, 48px PWA tech).

---

## 6. Cartes

Tokens (globals.css `@theme`) :

- **Ombres teintées navy-deep (rgba(15,32,64,…))**, 3 niveaux :
  - `--shadow-card` : `0 1px 2px rgba(15,32,64,0.04), 0 4px 12px rgba(15,32,64,0.05), 0 0 0 1px rgba(15,32,64,0.04)` — surface au repos ;
  - `--shadow-raised` : `0 2px 4px rgba(15,32,64,0.06), 0 8px 24px rgba(15,32,64,0.10)` — menus, popovers, hover ;
  - `--shadow-overlay` : `0 1px 2px rgba(15,32,64,0.06), 0 12px 32px rgba(15,32,64,0.18), 0 0 0 1px rgba(15,32,64,0.06)` — modales/drawers.
- **Rayons** : `--radius-ctl: 8px` (contrôles) · `--radius-card: 10px` (cartes,
  panels, menus) · `--radius-modal: 14px` (modales, drawers). Utilitaires
  `rounded-ctl / rounded-card / rounded-modal`.

Classes cartes :

- `.fxs-card` = `background: var(--color-cream); border-radius: var(--radius-card); box-shadow: var(--shadow-card);` ; option `.fxs-card-hover` : `transition: transform .15s, box-shadow .15s` + hover `translateY(-2px)` et `var(--shadow-raised), 0 0 0 1px var(--color-navy-light)`.
- `.premium-card` (legacy, même rendu + `border: 1px solid var(--color-sand-border)`, transitions 0.2s ease).
- Pattern utilitaire très répandu (module facturation) : `bg-cream border border-sand-border rounded-2xl p-4` (blocs de formulaire) et `bg-cream rounded-xl border border-sand-border` (tableaux).
- Padding interne : `p-3.5` à `p-5` ; en-tête de carte = `.fxs-block-title` ou libellé `text-[11px] font-bold text-ink-muted uppercase tracking-widest`.

---

## 7. Icônes

- **Bibliothèque unique : `lucide-react` ^1.14.0** (imports nommés, style outline).
- Tailles observées : `size={12}` (liens-actions), `14` (boutons), `16` (en-têtes),
  `18` (accordéon, sidebar), `22` (bottom-nav tech).
- Couleur : héritée du texte (`currentColor`) — jamais de couleur propre.
- Convention : `aria-hidden` posé sur les icônes décoratives ;
  type `LucideIcon` utilisé pour les props d'icônes (NavItem, RowMenuItem).

---

## 8. Navigation

**Sidebar admin** (`components/Sidebar.tsx` — styles inline, commentaire « pas
de Tailwind JIT requis ») :
- Desktop : largeur **220px**, `position: sticky; top: 0; height: 100vh`,
  fond `linear-gradient(180deg, var(--color-navy-dark) 0%, var(--color-navy-deep) 100%)`,
  bordure droite `rgba(255,255,255,.04)`. Zone logo (logo **blanc**) bordée
  `rgba(255,255,255,.08)`. Scrollbar invisible au repos, pouce
  `rgba(255,255,255,0.22)` au hover (`.foxo-sidebar-desktop`, globals.css).
- Item : `padding 9px 12px`, radius 8, 13px, inactif
  `rgba(253,251,247,0.65)` 500 ; **actif** : cream 600, fond
  `rgba(168,212,232,0.10)`, `border-left: 2px solid var(--color-sky-foxo)`
  (padding-left compensé 12→10).
- Badges compteurs : fond `--color-amber-foxo`, texte cream, radius 20,
  10px 600 (alertes, à-valider, mails non lus — event `foxo:mails-updated`
  refetch débouncé 800ms).
- Groupes : NAV_MAIN, menu dépliable « Partenaires » (syndics/courtiers/
  experts/métiers), NAV_GESTION ; « Comptabilité » highlight aussi sur
  `/admin/facturation`.
- **Mobile ≤768px** : `<style>` embarqué — `.foxo-sidebar-desktop { display:none }`,
  `.foxo-sidebar-mobile { display:flex !important }` : bottom-nav fixe 6 items,
  même gradient navy, `padding-bottom: env(safe-area-inset-bottom, 8px)`,
  items 10px, `minWidth: 48, minHeight: 44`, pastilles ambre superposées.

**Bottom-nav tech** (`src/app/tech/TechBottomNav.tsx`) : fixe bas `z-40`,
fond **blanc** `#FFFFFF`, `border-top: 1px solid #E6E2DC`,
`padding-bottom: env(safe-area-inset-bottom, 0px)`, contenu `max-w-[640px]`
centré, 4 items (`/tech`, `/tech/historique`, `/tech/assistant`,
`/tech/notes-frais`), `min-h-[58px]`, icône 22 + libellé
`text-[10px] font-bold uppercase tracking-wider` ; actif = `#34D399` + point
1.5×1.5 au-dessus, inactif `#9A9690`. Header tech : sticky 64px, gradient navy,
logo blanc 36.

**Portail partenaire** (`src/app/portal/PortalNav.tsx`) : sidebar 220px calquée
sur l'admin, gradient `#0f1e35 → #1a3a5c`, item 11px, actif
`border-left: 3px solid #60A5FA` + fond `rgba(96,165,250,0.15)` ; bouton accent
« Nouvelle demande » plein (couleur selon orgType) ; **mobile <1024px**
(`@media (max-width: 1023px)`) : header fixe + bottom-nav iOS-style ;
LangSwitcher (fr/nl/en) et NotificationBell dans le chrome.

**Onglets** : `FacturationTabs.tsx` — bandeau horizontal sous le header
(`px-3.5 py-2 rounded-t-lg text-[12px] font-bold border-b-2`, actif
`bg-cream border-navy text-navy`, inactif `border-transparent text-ink-muted`),
matching exact ou par préfixe.

**Pattern drawer `?id=`** : navigation interne par query param — liens du type
`/admin/syndics?id=${id}`, `/admin/mails?id=${gmail_message_id}`
(InterventionsClient.tsx l.2044, 4322, 4694) : la page liste ouvre la fiche/
le drawer correspondant. Les drawers modaux locaux (NoteFraisDrawer,
FournisseursClient) utilisent un state React, panneau latéral droit
`max-w-[400-420px]` sur backdrop `bg-black/40`.

---

## 9. Formulaires

Pattern uniforme (FactureEditor.tsx, NewRequestClient.tsx, FournisseursClient.tsx…) :

- **Label** : `text-xs font-semibold text-ink-mid block mb-1.5` ; obligatoire
  signalé par ` *` dans le libellé (parfois `<span className="text-terra">*</span>`).
- **Input/textarea/select** :
  `w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid`
  (variante compacte `px-2.5 py-1.5 rounded-md`) ; champs numériques/références
  avec `font-mono` + `inputMode="decimal"` ; désactivé
  `disabled:bg-sand-mid disabled:text-ink-muted`.
- **Placeholders** (règle globale, globals.css) : `color: var(--color-ink-muted);
  font-style: italic;` — les exemples sont préfixés « ex : » pour ne pas
  ressembler à une valeur enregistrée.
- **Validation** : côté serveur dans les Server Actions (retour
  `ActionResult = { ok:true, data? } | { ok:false, error }`, messages en
  français) ; contrôles client minimaux avant envoi.
- **Messages** : bandeau feedback
  `text-[12px] rounded-md px-3 py-2 border font-semibold` — succès
  `bg-ok-light border-ok-mid text-ok`, erreur `bg-terra-light border-terra-mid
  text-terra` ; erreur de champ ponctuelle `text-[11px] text-terra mt-1.5`.
- **Autocomplete** : input + dropdown `bg-white border border-sand-border
  rounded-lg divide-y divide-sand-mid max-h-[180-280px] overflow-y-auto`,
  debounce `setTimeout` 280ms, requête ≥ 2 caractères (interventions, clients,
  dossiers).
- **Multi-étapes** (portail nouvelle demande) : stepper à points, connecteurs
  `h-px` `bg-ok` (fait) / `bg-sand-border` (à venir).
- Champs pré-remplis par IA à vérifier : surlignage `bg-amber-light border
  border-[#E8C896]` + score « IA NN% — à vérifier » (AchatDetailClient).

---

## 10. Animations

Toutes définies dans `src/app/globals.css` (« Micro-interactions D7 ») :

- **Hover global 150ms** : `:where(button, a, [role='button'], [role='tab'])`
  → `transition: background-color .15s ease, color .15s ease, border-color .15s
  ease, box-shadow .15s ease, opacity .15s ease` (couleurs/ombres uniquement,
  pas de transform) ; `:where(tbody tr)` → `background-color .15s ease` ;
  `.row-hover` → `background-color .15s ease` + `cursor:pointer`.
- **Focus clavier** : `:where(a, button, [role='button'], [role='tab'],
  summary):focus-visible` → `outline: 2px solid var(--color-navy);
  outline-offset: 2px` (spécificité nulle via `:where()`) ; sur surfaces navy
  (`.foxo-sidebar-desktop`, `.hub-tile`) l'anneau passe à
  `var(--color-sky-foxo)`.
- **Cartes** : `.fxs-card-hover` transform/shadow **0.15s**, hover
  `translateY(-2px)` ; `.premium-card` **0.2s ease**.
- **Hub tiles** (glassmorphism sur navy) : fond `rgba(255,255,255,0.07)`,
  `backdrop-filter: blur(8px)`, transitions **0.25s ease**, hover
  `translateY(-4px)` + `0 12px 32px rgba(59,114,176,0.25)` ; keyframes
  `hubFadeInUp` (opacity 0 / translateY(12px) → 1 / 0).
- **Skeleton** : `.fx-skeleton` fond sand-mid, radius 6px, animation
  `fx-skeleton-pulse 1.6s ease-in-out infinite` (opacity 1 → 0.55 → 1) ;
  **`@media (prefers-reduced-motion: reduce) { .fx-skeleton { animation:none } }`**
  (seule règle reduced-motion du code).
- Divers : chevron Accordion `transform 0.2s` ; icône relève `animate-pulse` ;
  spinners `animate-spin` (Loader2/RefreshCw).

---

## 11. Responsive Design

- **Breakpoints** : Tailwind par défaut (`sm:` 640px etc.) + deux media queries
  custom : **≤768px** (bascule sidebar admin → bottom-nav, `<style>` de
  Sidebar.tsx ; commentaire AdaptiveSection : « mobile : <768px ») et
  **≤1023px** (bascule sidebar portail → header + bottom-nav, PortalNav.tsx).
- **Outils** : `src/components/layout/AdaptiveSection.tsx` (visibilité par
  classes Tailwind, SSR-friendly, « pas de flash JS au mount ») et
  `src/hooks/useMediaQuery.ts` (`window.matchMedia` + listener `change`)
  quand le contenu diffère par breakpoint.
- **Admin** : desktop-first ; les listes denses passent en cartes mobiles
  (FacturationListClient a une vue table + une vue cartes) ; actions sticky en
  bas d'éditeur : `sticky bottom-[calc(80px+env(safe-area-inset-bottom,0px))]
  sm:bottom-0` (FactureEditor).
- **PWA tech** (mobile-first) : `src/app/tech/layout.tsx` — `metadata.manifest
  = '/manifest.webmanifest'`, `appleWebApp` (`capable`, statusBar
  `black-translucent`), `viewport` : `themeColor: '#1B3A6B'`,
  `maximumScale: 1, userScalable: false` ; service worker `public/sw.js`
  enregistré par `PWARegister` (scopé au layout tech), fallback
  `public/offline.html` ; contenu `max-w-[640px]` ; `env(safe-area-inset-bottom)`
  sur la bottom-nav et le padding du main ; photo ticket via
  `<input type="file" capture="environment">`.
- **Portail** : desktop-first, utilisable tablette (bascule 1023px).

---

## 12. Accessibilité

Aucune charte formalisée — pratiques observées dans le code :

- **Focus visible global** au clavier (cf. §10), couleur adaptée aux surfaces
  sombres ; ConfirmDialog verrouille le focus sur le bouton de confirmation à
  l'ouverture et ferme sur Escape/backdrop.
- **ARIA** : `aria-hidden` systématique sur les icônes décoratives et skeletons
  (`aria-hidden="true"` dans Skeleton.tsx) ; `aria-expanded` (Accordion),
  `role="dialog"` + `aria-modal="true"` + `aria-label` (modales d'aperçu),
  `aria-label` sur boutons icône (« Fermer »), `ariaLabel` prop de RowMenu,
  `sr-only` pour les en-têtes de colonnes d'actions.
- **Cibles tactiles** : `min-h-[44px]` récurrent (commentaire TechBottomNav :
  « min-height 44px par item (touch target Apple HIG) »), items bottom-nav
  admin `minWidth: 48, minHeight: 44`, tech 58px, CTA mobiles 48–52px.
- **Fermeture clavier** : Échap géré sur DocPreviewModal, ConfirmDialog,
  aperçu achats.
- **Contrastes** : texte ink `#1C1A16` sur sand/cream ; sur navy, texte cream
  ou `rgba(253,251,247,0.65)`. Pas d'outillage de vérification automatique
  dans le repo.
- Tailles : le contenu « de travail » est en 12–14px ; de nombreux libellés
  méta descendent à 10–11px (badges, labels uppercase).
- Langue : `<html lang="fr">` ; portail multilingue fr/nl/en
  (`src/lib/portal/i18n.ts`, fallback FR ; note en tête : traductions NL/EN
  générées par IA, à faire relire).

---

## 13. Composants réutilisables (`src/components/` + `components/`)

| Fichier | Rôle (d'après le code/commentaires d'en-tête) |
|---|---|
| `components/Sidebar.tsx` | Sidebar admin (desktop 220px + bottom-nav mobile), badges compteurs |
| `components/layout/MainContent.tsx` | Wrapper main admin : fond sand + 2 radial-gradients signature (sky-foxo 12%/−5% à 0.18 ; terra 95%/100% à 0.05), padding `px-6 py-6` |
| `components/layout/MainContentTech.tsx` | Variante tech : max-w 640, 1 gradient sky top-center 0.12, paddings 16px + 90px bas |
| `src/components/AddressAutocomplete.tsx` | Autocomplete d'adresse (valeur structurée rue/numéro/CP/ville) |
| `src/components/ComingSoon.tsx` | Placeholder sections admin non implémentées |
| `src/components/ConfirmDialog.tsx` | Modale de confirmation (titre, message, destructive?, pending?, focus lock, Escape/backdrop) |
| `src/components/DownloadButton.tsx` | Bouton outline navy — fetch → blob → download nommé, spinner |
| `src/components/Logo.tsx` | Logo FoxO 2 variantes : `noir` (fonds clairs) / `blanc` (navy) |
| `src/components/MessagesPanel.tsx` | Fil de messages admin ↔ partenaire (bulles par auteur_type) |
| `src/components/PWARegister.tsx` | Enregistrement du service worker (layout /tech) |
| `src/components/QrPaiement.tsx` | QR EPC + IBAN copiable (BIC NICABEBB en dur) |
| `src/components/RowMenu.tsx` | Menu contextuel « ⋯ » par ligne (items icône/label, `direction: 'up'|'down'`, destructive, hidden) |
| `src/components/SendSmsModal.tsx` | Modale d'envoi SMS avec préview + estimation de coût |
| `src/components/StatutBadge.tsx` | Badge statut intervention multilingue (couleurs de `STATUT_INFO`) |
| `src/components/TypeBadge.tsx` | Badge type partenaire (couleurs solides : courtier `#A17244`, syndic `#1B3A6B`, particulier `#1F6B45`…) |
| `src/components/admin/ActionConfirmCard.tsx` | Carte de confirmation d'action proposée par l'assistant IA |
| `src/components/admin/ChatIA.tsx` | Chat express du tableau de bord (API `/api/admin/assistant/chat`) |
| `src/components/admin/CollapsedSection.tsx` | Ligne compacte pour section à zéro (tones terra/amber/navy) |
| `src/components/admin/NextMissions.tsx` | Missions du jour condensées (données du server component parent) |
| `src/components/layout/AdaptiveSection.tsx` | Visibilité responsive par classes (mobile <768px) |
| `src/components/portal/SyndicMap.tsx` (+ `SyndicMapWrapper`) | Carte Leaflet des interventions (dynamic import `ssr:false`) |
| `src/components/ui/Skeleton.tsx` | `Skeleton` + `SkeletonText` (lines, dernière raccourcie w-3/5) sur `.fx-skeleton` |
| `src/components/ui/Accordion.tsx` | Bloc dépliable mobile (card cream + shadow-card, chevron rotatif, badge navy-pale) |

Composants « module » notables colocalisés dans `src/app/` :
`DocPreviewModal`, `PeppolActions`, `OdooActions`, `RevertToBrouillonButton`,
`FacturationTabs`, `FactureEditor`, `NoteFraisDrawer`, `RelancesAutoBlock`,
`BaremeKmSection`, `SocieteSection`, `PortalNav`, `TechBottomNav`.

---

## 14. Conventions de développement

Aucun document de conventions dans le repo (hors CLAUDE.md/AGENTS.md) —
pratiques observées :

- **Server Components par défaut** ; interactivité isolée dans des
  `XxxClient.tsx` avec `'use client'` en première ligne ; la page serveur
  fetch (Supabase) et passe des props sérialisées.
- **Server Actions** : fichiers `actions.ts` par domaine, `'use server'`,
  garde `assertAdmin()` locale (createClient + isAdminUser) en tête de chaque
  action, retour `ActionResult<T> = { ok:true; data? } | { ok:false; error:string }`,
  `revalidatePath()` après écriture. Écritures sensibles via `createAdminClient()`.
- **Routes API** : `NextResponse.json({ ok, ... })`, statuts 400/403/404/500
  explicites, messages d'erreur en français ; `export const dynamic =
  'force-dynamic'` et `maxDuration` posés par route (30/60/120/300 selon coût).
- **Nommage** : composants PascalCase, lib camelCase/kebab-case ; vocabulaire
  métier **en français** dans le code (facture, releve, echecs, annee…) ;
  commentaires en français, souvent longs et normatifs (en-têtes de fichiers
  expliquant le pourquoi).
- **Styles** : Tailwind utilitaires + tokens (`bg-cream`, `var(--color-*)`) ;
  styles inline `const S = {...}` pour les sidebars (« pas de Tailwind JIT
  requis ») ; tailles au pixel via classes arbitraires `text-[13px]`,
  `min-h-[44px]`, `max-w-[640px]`.
- **Textes UI** : tout en français ; portail partenaire via `useT()`/
  `vocab.ts` (jamais de vocabulaire métier hardcodé côté portail).
- **Effets React 19** : règle `react-hooks/set-state-in-effect` respectée —
  état dérivé plutôt que setState sync dans les effets (commentaires explicites
  dans FactureEditor et Sidebar), debounce via `setTimeout` dans les effets.
- **Git** : hook husky pre-push = `tsc --noEmit` ; convention commits
  `type(scope): message` en français ; jamais de squash (convention maison,
  cf. ETAT_PROJET.md).

---

## 15. Dépendances importantes

Cf. tableau §1. Points saillants :

- **Tailwind v4** sans fichier de config : tokens et fonts déclarés dans
  `@theme` (globals.css) ; PostCSS unique plugin `@tailwindcss/postcss`.
- **Supabase** : 3 clients (`src/lib/supabase/client.ts` navigateur,
  `server.ts` SSR cookie-aware, `admin.ts` service-role).
- **lucide-react** : seule source d'icônes.
- **@react-pdf/renderer** : rendu PDF serveur (`renderToBuffer`), polices
  Helvetica/Courier intégrées, styles via `StyleSheet.create`.
- **resend** (from `VENDOR_BILLING_FROM` = `FoxO <facturation@send.foxo.be>`,
  `src/lib/constants/vendor.ts`) et Gmail API maison (`src/lib/gmail.ts`)
  cohabitent pour l'envoi d'emails.
- **@anthropic-ai/sdk** : agents (triage mails, extraction cas/achat,
  assistant, rapport) — modèle courant `claude-sonnet-4-6` pour les
  extractions.

---

## 16. Contraintes techniques

- **RLS partout** : chaque table a `enable/force row level security` + policies
  `is_admin()` (`for all to authenticated using (public.is_admin()) with check
  (…)` — cf. `db/migrations/*.sql`) ; certaines tables sont lecture-admin
  seule (sequences_facturation, cas_terrain_echecs), les écritures passant
  par le service role.
- **`createAdminClient()`** (`src/lib/supabase/admin.ts`) : client
  service-role — « usage strictement serveur », throw si
  `SUPABASE_SERVICE_ROLE_KEY` absente ; ne JAMAIS l'exposer côté client.
- **`runAgent`** (`src/lib/observability/agent-logger.ts`) : « TOUT appel
  Anthropic depuis le code applicatif DOIT passer par runAgent. Aucune
  exception. » — log en `agent_logs` (tokens, coût, durée, statut) ;
  `inputSummary`/`outputSummary` **sans PII** ; erreurs de parse JSON
  préfixées `JSON parse: … (preview: …)`. Les jobs planifiés passent par
  `logAutomationJob` (table `automation_jobs`). `AgentName` est une union TS
  fermée, miroir de la contrainte SQL `agent_logs_agent_name_check`.
- **Multi-tenant naissant** : table `societes` (« FoxO = premier client »,
  seed unique), colonnes `societe_id` sur les tables du bloc achats/frais —
  l'app fonctionne aujourd'hui mono-société (première société active).
- **Vercel (plan Hobby)** : crons natifs limités à 1/jour → un seul cron dans
  `vercel.json` (`/api/cron/rappel-j1` à 8h) ; les autres déclencheurs sont
  des workflows GitHub Actions (`.github/workflows/ingest-cas-terrain.yml`,
  cron-check-mails, cron-calendar-watch) appelant les routes `/api/cron/*`
  protégées par `Bearer CRON_SECRET` + interrupteur `parametres.*`.
  `maxDuration` par route (max 300s). `outputFileTracingIncludes` embarque
  les assets lus par `fs` (prompts .md, logos PDF, fonts) ;
  `serverActions.bodySizeLimit: '10mb'`.
- **En-têtes de sécurité globaux** (next.config.ts, toutes routes) :
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, HSTS 1 an preload.
  Conséquence : rien ne s'iframe directement — l'aperçu PDF interne passe par
  `fetch → blob → URL.createObjectURL` (DocPreviewModal).
- **Environnement de dev éphémère** (conteneur cloud) : `node_modules` absent
  au démarrage (`npm ci` requis), convention commit + push après chaque tâche,
  `tsc --noEmit` vert avant tout push (hook pre-push).
- **Intégrations éteintes par défaut** : Storecove/Peppol, Odoo, relances auto
  — double interrupteur (variables d'environnement + clé `parametres`),
  zéro appel réseau tant que non activées.

---

## Design Rules Summary

Spécification condensée pour reproduire le style et l'architecture à l'identique :

**Fondations.** Next.js 16 App Router + React 19 + TS strict. Tailwind v4 SANS
config : tokens dans `@theme` de `globals.css`. Mono-thème clair
(`color-scheme: light`), variante `dark:` neutralisée par
`@custom-variant dark (&:where(.dark, .dark *))`. Body : DM Sans 14px
antialiased, fond `#F5F2EC` (sand), texte `#1C1A16` (ink).

**Couleurs (tokens obligatoires, jamais de hex en dur hors exceptions listées §2).**
Surfaces : sand `#F5F2EC` / sand-mid `#EDE8DF` / sand-border `#DDD8CC` /
sand-hover `#F8F4EE` / cream `#FDFBF7` (cartes). Texte : ink `#1C1A16` /
ink-mid `#6B6558` / ink-muted `#A09A8E`. Primaire navy `#1B3A6B`
(dark `#152D54`, deep `#0F2040`, mid `#2A5298`, light `#D6E4F7`, pale `#EBF2FB`).
Sémantiques : succès ok `#1F6B45` (+light `#E4F2EB`, mid `#B8D9C8`) ; erreur
terra `#C4622D` (+light `#F7EDE5`, mid `#E8C4AF`) ; avertissement amber-foxo
`#B8830A` (+light `#FBF3E0`). Accents : sky-foxo `#A8D4E8` ; vert tech
`#34D399` (PWA tech uniquement). Une seule couleur d'accent par écran.

**Typo.** DM Sans = corps (défaut). Sora 600 = titres :
24px/−0.03em/lh1 (`.fxs-page-title`) · 20px/−0.02em (`.fxs-title-sm`) ·
15px (`.fxs-section-title`) · 13px (`.fxs-block-title`). Inter via
`.font-inter`, Syne `.font-display` (legacy hubs), DM Mono pour numéros/
montants/dates (`font-mono`). Tables en `tabular-nums` (global). Labels méta :
10–11px bold uppercase `tracking-wider`/`widest` ink-muted.

**Surfaces.** Carte = cream + `--radius-card` 10px + `--shadow-card`
(triple stack teinté `rgba(15,32,64,…)` : 0 1px 2px .04 / 0 4px 12px .05 /
ring 1px .04). Hover cliquable : `translateY(-2px)` + `--shadow-raised` +
ring `navy-light`, 150ms. Modales/drawers : `--radius-modal` 14px +
`--shadow-overlay`, backdrop `bg-black/40-50`. Contrôles : `--radius-ctl` 8px
(`rounded-lg`). Blocs formulaire : `bg-cream border border-sand-border
rounded-2xl p-4/p-5`.

**Boutons.** Primaire `bg-navy text-white rounded-lg font-bold text-[12-13px]
hover:opacity-90 disabled:opacity-50 min-h-[40-44px]` ; secondaire blanc
bordé navy-light hover navy-pale ; danger terra ; chips filtres en pill
(`rounded-full`, actif navy plein) ; bouton désactivé = sand-mid + raison
dans `title`. Pas de composant central : répéter ces classes.

**Formulaires.** Label `text-xs font-semibold text-ink-mid mb-1.5` ; input
`px-3 py-2.5 border-sand-border rounded-lg text-[13px] bg-white
focus:border-navy-mid` ; placeholders italiques ink-muted préfixés « ex : » ;
feedback bandeau ok-light/terra-light bordé + `font-semibold text-[12px]` ;
validation serveur (`ActionResult`, messages français) ; autocomplete
debounce 280ms ≥2 caractères.

**Micro-interactions.** Transitions 150ms ease (couleurs/ombres seulement)
sur boutons/liens/onglets/lignes ; focus-visible `outline 2px navy offset 2`
(sky-foxo sur fond navy) ; skeleton `.fx-skeleton` sand-mid pulse 1.6s +
`prefers-reduced-motion` → none ; hubs : glass `rgba(255,255,255,.07)` +
blur 8px, 250ms, fadeInUp 12px.

**Gabarits.** Admin : sidebar navy sticky 220px (gradient navy-dark→deep,
actif = borderLeft 2px sky-foxo + fond sky 10%, badge ambre) + `MainContent`
(sand + 2 radial-gradients sky/terra, `px-6 py-6`) ; ≤768px → bottom-nav navy
6 items (safe-area). Tech : mobile-first `max-w-[640px]`, header navy sticky
64px, bottom-nav blanche accent `#34D399`, padding-bas
`calc(90px + safe-area)` ; PWA (manifest, sw.js, themeColor `#1B3A6B`,
cibles ≥44px). Portail : sidebar navy `#0f1e35→#1a3a5c`, actif `#60A5FA`,
bascule <1024px ; textes via `vocab.ts`/i18n fr-nl-en. En-tête de page :
titre `.fxs-page-title` + sous-ligne 11px à puce ronde, `mb-6 pb-3.5 border-b
sand-border`. Tableaux denses : th 10px uppercase ink-muted, td `px-3.5
py-2.5` 12px, hover sand-hover ; états gérés partout (skeleton / vide avec
action / erreur en français).

**Architecture.** Page = Server Component (fetch Supabase SSR) → gros client
colocalisé `'use client'` ; mutations = Server Actions `actions.ts`
(`assertAdmin` + `ActionResult` + `revalidatePath`) ; écritures RLS-bypass via
`createAdminClient` (serveur uniquement) ; IA uniquement via `runAgent` ;
jobs via `logAutomationJob` + routes `/api/cron/*` (Bearer CRON_SECRET +
interrupteur `parametres`), déclencheurs GitHub Actions (Vercel Hobby = 1 cron
natif) ; en-têtes sécurité globaux (XFO DENY → aperçus PDF par blob) ;
`tsc --noEmit` vert avant push (hook), commits `type(scope): …` en français,
jamais de squash.
