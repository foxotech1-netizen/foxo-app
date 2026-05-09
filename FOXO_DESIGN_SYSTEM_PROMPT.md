# FoxO — Prompt d'application universelle du Design System

> **Comment l'utiliser en 3 étapes :**
> 1. Place ce fichier à la racine de `foxo-app`
> 2. Lance la **Phase 0** (setup unique) en collant le prompt §A ci-dessous dans Claude Code
> 3. Pour chaque page, lance le prompt §B en remplaçant le chemin

---

## 🚀 PHASE 0 — Setup unique (à faire UNE seule fois)

### Prompt §A à coller dans Claude Code

```
Lis FOXO_DESIGN_SYSTEM_PROMPT.md à la racine du projet. Effectue UNIQUEMENT le setup initial décrit dans la section "Phase 0". Ne touche à aucune page individuelle, juste les fichiers globaux : layouts racines, globals.css, et imports de polices. Confirme-moi quand c'est fait.
```

### Ce que Claude Code doit faire en Phase 0

#### 1. Vérifier que les CSS variables sont dans `app/globals.css`

Les variables `--color-sand`, `--color-cream`, `--color-navy`, `--color-terra`, `--color-amber-foxo`, `--color-ok`, `--color-ink`, etc. doivent exister dans `:root`. **Si elles existent déjà** (ce qui est le cas d'après les DevTools), passer à l'étape 2. Sinon, les ajouter.

#### 2. Importer Sora + Inter dans `app/layout.tsx` racine

```tsx
import { Sora, Inter } from 'next/font/google';

const sora = Sora({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-sora',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
});

export default function RootLayout({ children }) {
  return (
    <html lang="fr" className={`${sora.variable} ${inter.variable}`}>
      <body className="font-inter antialiased">{children}</body>
    </html>
  );
}
```

#### 3. Étendre `tailwind.config.ts` avec les fonts

```ts
theme: {
  extend: {
    fontFamily: {
      sora: ['var(--font-sora)', 'sans-serif'],
      inter: ['var(--font-inter)', 'sans-serif'],
    },
  },
},
```

#### 4. Créer un composant `MainContent` réutilisable

Créer `components/layout/MainContent.tsx` :

```tsx
export function MainContent({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <main
      className={`min-h-screen ${className}`}
      style={{
        background: 'var(--color-sand)',
        backgroundImage:
          'radial-gradient(circle at 12% -5%, rgba(168, 212, 232, 0.18) 0%, transparent 45%), radial-gradient(circle at 95% 100%, rgba(196, 98, 45, 0.05) 0%, transparent 45%)',
      }}
    >
      <div className="px-6 py-6">{children}</div>
    </main>
  );
}
```

#### 5. L'intégrer dans CHAQUE Layout de portail (sans toucher la sidebar)

Pour chacun de ces fichiers (à adapter selon la structure réelle du projet) :
- `app/(admin)/layout.tsx`
- `app/(tech)/layout.tsx`
- `app/(portal)/syndic/layout.tsx`
- `app/(portal)/courtier/layout.tsx`
- `app/(portal)/expert/layout.tsx`

**Pattern à appliquer :**

```tsx
import { Sidebar } from '@/components/sidebar/Sidebar'; // ⚠️ NE PAS MODIFIER
import { MainContent } from '@/components/layout/MainContent';

export default function AdminLayout({ children }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar /> {/* INTACTE — ne pas toucher */}
      <MainContent className="flex-1">{children}</MainContent>
    </div>
  );
}
```

⚠️ **Pour `portal.foxo.be/rdv`** : pas de sidebar, le `MainContent` couvre toute la page.

### ✅ Critères de validation Phase 0

- [ ] Sora et Inter chargent (vérifier dans Network ou DevTools)
- [ ] Le background sand + gradients est visible dans toutes les zones main content
- [ ] Aucune sidebar n'a été modifiée
- [ ] `font-sora` et `font-inter` fonctionnent comme classes Tailwind

---

## 🔁 PHASE 1+ — Refacto page par page

### Prompt §B à coller pour CHAQUE page

```
Lis FOXO_DESIGN_SYSTEM_PROMPT.md. Applique le design system à <CHEMIN_DE_LA_PAGE>.

Règles strictes :
- Ne touche PAS à la sidebar ni au layout parent (Phase 0 déjà faite)
- Refacto uniquement le contenu de cette page
- Utilise UNIQUEMENT var(--color-xxx), aucun hex en dur
- Respecte les patterns du fichier : header de page, KPI cards, panels, alertes, pills, boutons
- Police : Sora pour titres/chiffres/refs, Inter pour le reste
- Box-shadow signature obligatoire sur toutes les cards
- Vérifie chaque case de la "Checklist de validation" à la fin

Quand c'est fini, montre-moi un avant/après et liste ce qui a changé.
```

### Exemples concrets d'invocations

```
Lis FOXO_DESIGN_SYSTEM_PROMPT.md. Applique le design system à app/(admin)/admin/mails/page.tsx.
```

```
Lis FOXO_DESIGN_SYSTEM_PROMPT.md. Applique le design system à app/(admin)/admin/comptabilite/page.tsx.
```

```
Lis FOXO_DESIGN_SYSTEM_PROMPT.md. Applique le design system à toutes les pages sous app/(tech)/. Fais-les UNE PAR UNE et confirme entre chaque.
```

---

## 🎯 Mission

Appliquer un design system unique sur **toutes les zones "main content"** de la plateforme FoxO multi-portails :
- `admin.foxo.be` — interface admin
- `tech.foxo.be` — interface techniciens (mobile-first)
- `portal.foxo.be/syndic` — portail syndics
- `portal.foxo.be/courtier` — portail courtiers
- `portal.foxo.be/expert` — portail experts sinistres
- `portal.foxo.be/rdv` — page publique de prise de RDV

## ⛔ Règle absolue : ne JAMAIS toucher aux sidebars

Les sidebars de chaque portail (background navy `linear-gradient(180deg, #152d54 0%, #0f2040 100%)`, items de nav, badges, sélecteur de thème, logo, bouton déconnexion) sont **l'identité de marque FoxO**. Elles restent strictement intactes.

Repère où la sidebar est rendue dans le `Layout` (généralement `<Sidebar />` ou `<aside>`) et **modifie uniquement le wrapper du `{children}`**.

## 🎨 Tokens à utiliser (déjà définis dans `:root` du projet)

⚠️ **TOUJOURS utiliser `var(--color-xxx)` — JAMAIS de hex en dur.** Le fichier `globals.css` contient déjà toutes ces variables.

### Identité primaire (navy)
| Token | Hex | Usage |
|---|---|---|
| `--color-navy` | `#1b3a6b` | Boutons primaires, liens, refs dossier (`2026-125`), accents identitaires, swatches |
| `--color-navy-mid` | `#2a5298` | Hover liens, états secondaires |
| `--color-navy-light` | `#d6e4f7` | Bordures décoratives |
| `--color-navy-pale` | `#ebf2fb` | Fonds de pills/badges navy |

### Fonds (sand & cream)
| Token | Hex | Usage |
|---|---|---|
| `--color-sand` | `#f5f2ec` | **Background main content** |
| `--color-sand-mid` | `#ede8df` | Séparateurs, lignes de tableau |
| `--color-sand-border` | `#ddd8cc` | Bordures |
| `--color-sand-hover` | `#f8f4ee` | Hover de lignes |
| `--color-cream` | `#fdfbf7` | **Background des cards** |

### Bleu doux (sky)
| Token | Hex | Usage |
|---|---|---|
| `--color-sky-foxo` | `#a8d4e8` | Barres de chart, données passées, accents info |
| `--color-sky-light-foxo` | `#e8f4fa` | Background info léger |

### Sémantique
| Token | Hex | Usage |
|---|---|---|
| `--color-terra` | `#c4622d` | **Urgences**, alertes critiques, actions destructives |
| `--color-terra-light` | `#f7ede5` | Background d'alerte |
| `--color-terra-mid` | `#e8c4af` | Bordure d'alerte |
| `--color-amber-foxo` | `#b8830a` | Pills "Mail", highlights premium, états "en attente" |
| `--color-amber-light` | `#fbf3e0` | Background pills amber |
| `--color-ok` | `#1f6b45` | **Validations**, confirmations, +% positif |
| `--color-ok-light` | `#e4f2eb` | Background states OK |
| `--color-ok-mid` | `#b8d9c8` | Bordures states OK |

### Hiérarchie texte (ink)
| Token | Hex | Usage |
|---|---|---|
| `--color-ink` | `#1c1a16` | Texte principal, valeurs importantes |
| `--color-ink-mid` | `#6b6558` | Texte secondaire, métadonnées |
| `--color-ink-muted` | `#a09a8e` | Labels, texte tertiaire, placeholders |

---

## 🔤 Typographie

Importer dans `app/layout.tsx` ou `globals.css` :

```ts
import { Sora, Inter } from 'next/font/google';

const sora = Sora({ subsets: ['latin'], weight: ['300','400','500','600','700'], variable: '--font-sora' });
const inter = Inter({ subsets: ['latin'], weight: ['400','500','600'], variable: '--font-inter' });
```

**Application :**
- **Sora** → titres de page, chiffres KPI, références dossier, valeurs numériques, badges count
- **Inter** → body, paragraphes, labels, navigation, formulaires (police par défaut)

**Hiérarchie standard :**

| Élément | Police | Taille | Weight | Tracking |
|---|---|---|---|---|
| H1 page | Sora | 24-26px | 300 (mot-clé : 600) | -0.03em |
| H3 panel | Sora | 12-13px | 500 | 0.01em |
| KPI value | Sora | 30-32px | 600 | -0.04em |
| Label uppercase | Inter | 10px | 500 | 0.12em |
| Body | Inter | 13px | 400 | normal |
| Refs dossier | Sora | 12px | 600 | 0.01em |

---

## 🌅 Background du main content (à appliquer dans le layout)

```css
.main-content {
  background: var(--color-sand);
  background-image:
    radial-gradient(circle at 12% -5%, rgba(168, 212, 232, 0.18) 0%, transparent 45%),
    radial-gradient(circle at 95% 100%, rgba(196, 98, 45, 0.05) 0%, transparent 45%);
  padding: 22px 24px 26px;
  min-height: 100vh;
}
```

---

## 🃏 Cards flottantes (pattern signature)

**Triple shadow stack** à utiliser pour TOUTES les cards :

```css
.card {
  background: var(--color-cream);
  border-radius: 10px;
  padding: 16px 18px;
  box-shadow:
    0 1px 2px rgba(15, 32, 64, 0.04),
    0 4px 12px rgba(15, 32, 64, 0.05),
    0 0 0 1px rgba(15, 32, 64, 0.04);
}
```

**Hover (cards cliquables uniquement) :**

```css
.card:hover {
  transform: translateY(-2px);
  box-shadow:
    0 2px 4px rgba(15, 32, 64, 0.06),
    0 8px 24px rgba(15, 32, 64, 0.1),
    0 0 0 1px var(--color-navy-light);
  transition: transform 0.15s, box-shadow 0.15s;
}
```

---

## 🧩 Composants standards (à reproduire partout)

### Header de page

```jsx
<div className="flex justify-between items-end mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
  <div>
    <h1 className="font-sora text-2xl font-light tracking-tight text-[var(--color-ink)] leading-none mb-1">
      Tableau de <span className="font-semibold text-[var(--color-navy)]">bord</span>
    </h1>
    <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
      <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
      Vendredi 8 mai 2026
    </div>
  </div>
  <div className="flex gap-2 items-center">
    <span className="text-[11px] font-medium tracking-wide text-[var(--color-navy-dark)] bg-[var(--color-navy-pale)] px-3 py-1.5 rounded-full border border-[var(--color-navy-light)]">
      Période · Mai 2026
    </span>
    <button className="bg-[var(--color-navy)] hover:bg-[var(--color-navy-dark)] text-[var(--color-cream)] px-3.5 py-2 rounded-md text-xs font-medium shadow-sm">
      + Nouvelle intervention
    </button>
  </div>
</div>
```

### KPI Card

```jsx
<div className="kpi-card relative bg-[var(--color-cream)] rounded-[10px] p-4 cursor-pointer transition-all hover:-translate-y-0.5"
     style={{boxShadow: '0 1px 2px rgba(15,32,64,0.04), 0 4px 12px rgba(15,32,64,0.05), 0 0 0 1px rgba(15,32,64,0.04)'}}>
  <div className="text-[10px] font-medium tracking-[0.12em] uppercase text-[var(--color-ink-muted)] mb-2.5">
    Nouvelles
  </div>
  <div className="absolute top-4 right-4 w-[22px] h-[22px] rounded-md bg-[var(--color-navy-pale)] flex items-center justify-center">
    <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-navy)]"></span>
  </div>
  <div className="font-sora text-3xl font-semibold text-[var(--color-ink)] leading-none -tracking-[0.04em] mb-1.5">
    23
  </div>
  <div className="flex items-center gap-1 text-[11px] font-medium text-[var(--color-ok)]">
    <span className="w-0 h-0 border-l-[3px] border-r-[3px] border-l-transparent border-r-transparent border-b-[4px] border-b-[var(--color-ok)]"></span>
    +18% sem.
  </div>
</div>
```

**Variantes par type sémantique** (changer la couleur du `accent` et de `value`) :
- `k-navy` → primaire (par défaut)
- `k-sky` → info / en cours → `bg-[var(--color-sky-light-foxo)]` + dot `bg-[var(--color-sky-foxo)]`
- `k-terra` → urgent → value en `text-[var(--color-terra)]` + accent terra
- `k-amber` → en attente → accent amber
- `k-ok` → validé → accent ok

### Panel (section avec titre)

```jsx
<div className="bg-[var(--color-cream)] rounded-[10px] p-4"
     style={{boxShadow: '0 1px 2px rgba(15,32,64,0.04), 0 4px 12px rgba(15,32,64,0.05), 0 0 0 1px rgba(15,32,64,0.04)'}}>
  <div className="flex items-center gap-2.5 pb-3 mb-3 border-b border-[var(--color-sand-mid)]">
    <span className="w-[3px] h-3.5 rounded-sm bg-[var(--color-navy)]"></span>
    <h3 className="font-sora text-[13px] font-medium text-[var(--color-ink)] flex-1 m-0">
      Titre du panel
    </h3>
    <span className="font-sora text-[11px] font-semibold text-[var(--color-navy)] bg-[var(--color-navy-pale)] px-2 py-0.5 rounded-full">
      22
    </span>
  </div>
  {/* contenu */}
</div>
```

### Alert (urgence)

```jsx
<div className="flex items-center gap-3 bg-gradient-to-r from-[var(--color-terra-light)] to-[rgba(247,237,229,0.3)] border border-[var(--color-terra-mid)] border-l-[3px] border-l-[var(--color-terra)] px-4 py-2.5 rounded-r-lg mb-5">
  <div className="w-[22px] h-[22px] rounded-md bg-[var(--color-terra)] text-[var(--color-cream)] flex items-center justify-center text-sm font-semibold font-sora flex-shrink-0">!</div>
  <div className="flex-1 text-[13px] text-[var(--color-terra)] font-medium">
    <strong className="text-[var(--color-ink)] font-semibold">5 interventions urgentes</strong> en attente de traitement
  </div>
  <span className="text-[11px] text-[var(--color-terra)] font-semibold tracking-wide cursor-pointer">Traiter →</span>
</div>
```

### Pills de statut

```jsx
{/* Confirmé */}
<span className="text-[10px] font-semibold tracking-[0.1em] uppercase px-2.5 py-1 rounded-full bg-[var(--color-ok-light)] text-[var(--color-ok)]">Confirmé</span>

{/* En attente */}
<span className="text-[10px] font-semibold tracking-[0.1em] uppercase px-2.5 py-1 rounded-full bg-[var(--color-amber-light)] text-[var(--color-amber-foxo)]">En attente</span>

{/* Urgent */}
<span className="text-[10px] font-semibold tracking-[0.1em] uppercase px-2.5 py-1 rounded-full bg-[var(--color-terra-light)] text-[var(--color-terra)]">Urgent</span>

{/* Facturé */}
<span className="text-[10px] font-semibold tracking-[0.1em] uppercase px-2.5 py-1 rounded-full bg-[var(--color-navy-pale)] text-[var(--color-navy)]">Facturé</span>

{/* Pill "Mail" (canal de source) */}
<span className="text-[9px] font-semibold tracking-[0.1em] uppercase px-1.5 py-0.5 rounded bg-[var(--color-amber-light)] text-[var(--color-amber-foxo)]">Mail</span>
```

### Boutons

```jsx
{/* Primaire */}
<button className="bg-[var(--color-navy)] hover:bg-[var(--color-navy-dark)] text-[var(--color-cream)] px-3.5 py-2 rounded-md text-xs font-medium shadow-sm transition-colors">
  Action principale
</button>

{/* Secondaire */}
<button className="bg-[var(--color-cream)] hover:bg-[var(--color-sand-hover)] text-[var(--color-ink)] border border-[var(--color-sand-border)] px-3.5 py-2 rounded-md text-xs font-medium shadow-sm transition-colors">
  Action secondaire
</button>

{/* Link button */}
<button className="text-[var(--color-navy-mid)] hover:text-[var(--color-navy)] text-[11px] font-medium">
  Voir tout →
</button>
```

### Liste de dossiers

```jsx
<div className="grid grid-cols-[auto_auto_1fr_auto] items-center gap-3 py-2.5 px-1.5 border-b border-[var(--color-sand-mid)] cursor-pointer rounded-md hover:bg-[var(--color-sand)] hover:px-2.5 transition-all">
  <span className="text-[9px] font-semibold tracking-[0.1em] uppercase px-1.5 py-0.5 rounded bg-[var(--color-amber-light)] text-[var(--color-amber-foxo)]">Mail</span>
  <span className="font-sora text-xs font-semibold text-[var(--color-navy)]">2026-125</span>
  <div>
    <div className="text-[13px] text-[var(--color-ink)]">Regimo – Parte Group BV</div>
    <div className="text-[10px] text-[var(--color-ink-muted)] mt-0.5 tracking-wide">Av. Louise 437, 1050 Bruxelles</div>
  </div>
  <span className="text-[10px] text-[var(--color-ink-mid)] tracking-wide uppercase font-medium">Fuite infiltration</span>
</div>
```

---

## 📱 Règles contextuelles par portail

### `admin.foxo.be` — référence
Application 1:1 du design system ci-dessus.

### `tech.foxo.be` — mobile-first, terrain
Adaptations spécifiques :
- **Contraste renforcé** : remplacer `--color-ink-mid` par `--color-ink` pour les labels secondaires (lisibilité au soleil)
- **Padding cards augmenté** : 18px → 22px
- **Tailles texte +1px partout** (13px → 14px pour le body)
- **Boutons hauteur min 44px** (cible tactile)
- **Layout single column** par défaut, grid uniquement à `md:` breakpoint et au-delà
- **Touch targets** : min `min-h-[44px] min-w-[44px]` pour tous les éléments cliquables

### `portal.foxo.be/{syndic, courtier, expert}` — B2B partenaires
Application 1:1 du design system admin.

### `portal.foxo.be/rdv` — page publique grand public
Adaptations spécifiques (premier contact, signal de confiance) :
- **Hero/header** avec background `var(--color-navy)` ou gradient `linear-gradient(135deg, var(--color-navy) 0%, var(--color-navy-mid) 100%)`
- **CTAs primaires plus grands** : `text-base px-5 py-3.5`
- **Le sand reste sur les sections de contenu** (formulaire, étapes)
- **Logo FoxO en cream sur navy** dans le header
- **Pas de sidebar** sur cette page (page publique standalone)

---

## 🗺️ Routes à modifier (checklist)

### `admin.foxo.be`
- [ ] `/admin` (Tableau de bord avec carte des interventions)
- [ ] `/admin/alertes`
- [ ] `/admin/planning`
- [ ] `/admin/techniciens`
- [ ] `/admin/assistant`
- [ ] `/admin/partenaires`
- [ ] `/admin/clients`
- [ ] `/admin/comptabilite`
- [ ] `/admin/mails`
- [ ] `/admin/utilisateurs`
- [ ] `/admin/parametres`
- [ ] `/admin/dossiers/[ref]`

### `tech.foxo.be`
- [ ] `/tech` (dashboard)
- [ ] `/tech/planning`
- [ ] `/tech/intervention/[id]`
- [ ] `/tech/intervention/[id]/rapport`
- [ ] `/tech/intervention/[id]/photos`

### `portal.foxo.be`
- [ ] `/syndic` + dashboard + détail dossier + factures
- [ ] `/courtier` + dashboard + suivi
- [ ] `/expert` + dashboard + dossier sinistre
- [ ] `/rdv` (landing + formulaire)

---

## ⚙️ Méthodologie d'application page par page

Pour chaque page :

1. **Identifier le Layout** (`app/(admin)/layout.tsx` ou équivalent)
2. **Repérer la sidebar** — la laisser strictement intacte
3. **Modifier le wrapper du `{children}`** pour y appliquer le background sand + radial-gradients
4. **Refactorer chaque composant** de la page en suivant les patterns ci-dessus
5. **Remplacer toute valeur hex en dur** par `var(--color-xxx)`
6. **Vérifier la palette** : aucune couleur en dehors de navy/sand/cream/sky/terra/amber/ok/ink
7. **Tester visuellement** avant de passer à la page suivante

---

## ❌ Anti-patterns à éviter absolument

- ❌ Modifier la sidebar
- ❌ Hex en dur dans le code (`#FFFFFF`, `#1b3a6b`...) — toujours `var(--color-xxx)`
- ❌ Blanc pur `#FFFFFF` — utiliser `var(--color-cream)`
- ❌ Gris froids `#666`, `#999`, `gray-500` — utiliser la hiérarchie ink
- ❌ Police système ou Tailwind par défaut — toujours Sora/Inter
- ❌ Bordures `border-1` sans contexte — préférer le shadow stack
- ❌ Padding/spacing arbitraires — suivre l'échelle 4 / 8 / 12 / 16 / 18 / 22 / 24 px
- ❌ Chiffres importants en `font-bold` standard — utiliser `font-sora font-semibold`
- ❌ Introduction de nouvelles couleurs (rouge vif, vert flashy, violet, teal...)
- ❌ Emojis dans l'UI (sauf cas explicite produit)
- ❌ Multiples niveaux d'imbrication de cards (max 1 card dans 1 panel)

---

## 🎯 Critère de validation

Après refacto d'une page, elle doit cocher ces cases :

- [ ] Sidebar inchangée
- [ ] Background sand + radial gradients présents
- [ ] Toutes les cards utilisent le shadow stack signature
- [ ] Sora utilisé pour titres + chiffres KPI + refs
- [ ] Aucun hex en dur (grep `#[0-9a-fA-F]` doit ne rien retourner)
- [ ] Hiérarchie ink respectée pour tous les textes
- [ ] Couleurs sémantiques cohérentes (navy = primaire, terra = urgent, ok = validé, amber = attente, sky = info)
- [ ] Pills de statut suivent les patterns ci-dessus
- [ ] Hover states présents sur tous les éléments interactifs
- [ ] Responsive correct (single col mobile)

---

## 📦 Snippet d'import à ajouter en haut de chaque page (si manquant)

```tsx
// Vérifier que le layout parent applique déjà :
// - font-inter (par défaut)
// - le background sand + radial gradients sur le wrapper du children
// - les variables CSS dans :root via globals.css
```

---

**Une fois ce design system appliqué partout, FoxO aura une cohérence visuelle de niveau Linear / Attio / Vercel — bien au-dessus de Skwarel et autres SaaS B2B génériques.**
