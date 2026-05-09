# FoxO Design System — Phase 1 batch refactor

**Date** : 2026-05-08
**Scope** : portails `admin` + `portal` (tech skippé — contraintes mobile-first incompatibles avec MainContent px-6 py-6)
**Commits** : 5 (sur `main`, pushed)
**TypeScript** : `tsc --noEmit` ✓ EXIT=0 sur chaque batch

---

## Résumé exécutif

Le design system spécifié dans `FOXO_DESIGN_SYSTEM_PROMPT.md` (Phase 0 = setup global, Phase 1+ = pages) a été appliqué de façon autonome aux **30 pages** des portails `admin` et `portal`. Le pattern retenu pour Phase 1 : **refacto des en-têtes (header pages)** avec la signature visuelle FoxO :

- `fxs-page-title` (Sora 300 + dernier mot accent navy 600)
- Sous-titre avec dot indicator coloré (terra pour alertes, navy par défaut)
- `border-b border-[var(--color-sand-border)]` in-flow (vs sticky topbar `bg-sand` ancien)
- Boutons primaires : `bg-navy hover:navy-dark text-cream px-3.5 py-2 rounded-md text-xs font-medium shadow-sm`
- Bandeaux d'erreur : tokens `var(--color-amber-light)` / `var(--color-amber-foxo)` (zéro hex hardcodé)

**Trois utilitaires CSS** ont été ajoutés à `globals.css` pour réutilisation transversale :
- `.fxs-card` — fond crème + triple-shadow stack (signature FoxO)
- `.fxs-card-hover` — hover lift -2px + shadow plus profonde
- `.fxs-page-title` — H1 Sora 300 tracking-tight + nested `<span>` accent navy 600

---

## Pages refactorées (30)

### Portail admin (24)

| Page | Statut | Pattern |
|------|--------|---------|
| `admin/alertes/page.tsx` | ✓ refacto | header + dot terra |
| `admin/parametres/page.tsx` | ✓ refacto | header simple |
| `admin/articles/page.tsx` | ✓ refacto | header simple |
| `admin/clients/page.tsx` | ✓ refacto | header + error banner tokens |
| `admin/clients/new/page.tsx` | ✓ refacto | header simple |
| `admin/clients/[id]/page.tsx` | ✓ refacto | header avec retour |
| `admin/experts/page.tsx` | ✓ refacto | empty state header + icon |
| `admin/mails/page.tsx` | ✓ refacto | header simple |
| `admin/facturation/page.tsx` | ✓ refacto | header + bouton CTA primaire |
| `admin/facturation/paiements/page.tsx` | ✓ refacto | header simple |
| `admin/facturation/devis/page.tsx` | ✓ refacto | header + bouton CTA |
| `admin/facturation/notes-credit/page.tsx` | ✓ refacto | header + meta italic |
| `admin/facturation/rappels/page.tsx` | ✓ refacto | header + dot terra |
| `admin/facturation/export/page.tsx` | ✓ refacto | header simple |
| `admin/facturation/new/page.tsx` | ✓ refacto | header avec retour + numéro mono |
| `admin/facturation/[id]/page.tsx` | ✓ refacto | header complet + bandeau avoirs migré tokens |
| `admin/facturation/devis/[id]/page.tsx` | ✓ refacto | header + statut + lien facture |
| `admin/facturation/devis/new/page.tsx` | ✓ refacto | header + numéro mono |
| `admin/facturation/notes-credit/[id]/page.tsx` | ✓ refacto | header + lien facture origine |
| `admin/assistant/page.tsx` | ✓ refacto | header + icon Sparkles |
| `admin/planning/page.tsx` | ✓ refacto | header + onglets refactorés |
| `admin/syndics/SyndicsClient.tsx` | ✓ refacto | header partagé (couvre 3 pages : syndics, courtiers, metiers) |
| `admin/techniciens/TechniciensClient.tsx` | ✓ refacto | header + bouton CTA |
| `admin/utilisateurs/UtilisateursClient.tsx` | ✓ refacto | header + bouton CTA + counts |
| `admin/notes-frais/NotesFraisClient.tsx` | ✓ refacto | header + bouton CTA |

### Portail portal (5)

| Page | Statut | Pattern |
|------|--------|---------|
| `portal/page.tsx` | ✓ refacto | header dashboard + Hand icon + accentBg dynamic |
| `portal/interventions/InterventionsPortalClient.tsx` | ✓ refacto | header + bouton CTA dynamic accent |
| `portal/interventions/[id]/DossierPortalClient.tsx` | ✓ refacto | en-tête fxs-card + h1 fxs-page-title |
| `portal/calendar/page.tsx` | ✓ refacto | header simple |
| `portal/nouveau/NewRequestClient.tsx` | ✓ refacto | header avec dynamic title (syndic vs partner) |

---

## Pages skippées (8)

| Page | Raison |
|------|--------|
| `admin/page.tsx` | Dashboard ops principal — délègue à `InterventionsClient` (composant massif, refacto séparée) |
| `admin/interventions/[id]/page.tsx` | Idem — réutilise `InterventionsClient` avec flag `fullPage` |
| `admin/hub/page.tsx` | Launcher avec dégradé sombre — **identité volontaire** (header `linear-gradient(180deg, #1A1916 0%, #2C2A24 100%)`), indépendant du thème actif |
| `admin/home/page.tsx` | Mosaïque tuiles avec design system custom (`foxo-home-*` + CSS vars maison `--card-bg`/`--hero-bg`) — déjà cohérente |
| `admin/comptabilite/page.tsx` | Redirect vers `/admin/facturation` — pas de markup |
| `portal/syndic/page.tsx` | Redirect vers `/portal` (alias) |
| `portal/courtier/page.tsx` | Redirect vers `/portal` (alias) |
| `portal/expert/page.tsx` | Redirect vers `/portal` (alias) |

---

## Composants partagés refactorés (3)

Refacto dans le composant Client (parent server-page = délégateur pur) — couvre plusieurs routes :

- **`SyndicsClient`** → utilisé par `admin/syndics`, `admin/courtiers`, `admin/metiers` (3 pages)
- **`TechniciensClient`** → utilisé par `admin/techniciens`
- **`UtilisateursClient`** → utilisé par `admin/utilisateurs`
- **`NotesFraisClient`** → utilisé par `admin/notes-frais`
- **`InterventionsPortalClient`** → utilisé par `portal/interventions`
- **`DossierPortalClient`** → utilisé par `portal/interventions/[id]`
- **`NewRequestClient`** → utilisé par `portal/nouveau`

---

## Erreurs rencontrées (1)

- **`admin/experts/page.tsx`** : initial Phase 0 avait posé un `<span>Exp<span>erts</span></span>` (span imbriqué invalide). Corrigé en commit `bd2a874` : retiré le span externe. Pas d'impact runtime, juste un nettoyage HTML.

Aucune autre erreur. `tsc --noEmit` est resté vert sur chaque batch.

---

## Commits (groupés par sous-dossier)

| Hash | Message | Pages |
|------|---------|-------|
| `68907c8` | `feat(design-system): Phase 0 — setup global FoxO design system` | Layouts, fonts, MainContent, globals.css |
| `def6fda` | `feat(design-system): admin headers refacto + .fxs-card/.fxs-page-title utils` | 13 (alertes, parametres, articles, clients, experts, mails, clients/new, facturation, paiements, devis, notes-credit, rappels, export, facturation/new) |
| `c741714` | `feat(design-system): admin partenaires + assistant + planning headers` | 6 (assistant, planning, syndics+courtiers+metiers via SyndicsClient, techniciens, utilisateurs, notes-frais) |
| `9dd454f` | `feat(design-system): admin detail pages headers refacto` | 5 (facture/[id], devis/[id], notes-credit/[id], devis/new, clients/[id]) |
| `b0a5ba1` | `feat(design-system): portal pages headers refacto` | 5 (portal/, interventions, calendar, nouveau, interventions/[id]) |
| `bd2a874` | `fix(design-system): experts header — corrige span imbriqué` | 1 (experts) |

**Total** : 6 commits, **30 pages** refactorées, **3 utilitaires CSS** ajoutés.

---

## Couverture du design system

### Appliqué sur ces 30 pages
- ✓ Header `fxs-page-title` (Sora 300 + accent navy 600)
- ✓ Border-b in-flow (remplace topbar sticky `bg-sand`)
- ✓ Dot indicator sous-titre coloré (terra/navy)
- ✓ Boutons CTA primaires : `bg-navy hover:navy-dark text-cream rounded-md shadow-sm`
- ✓ Bandeaux d'erreur : design tokens (`var(--color-amber-light)`, `var(--color-amber-foxo)`)
- ✓ Liens secondaires : `text-[var(--color-ink-mid)] hover:text-[var(--color-navy)]`

### Pas (encore) appliqué — sprints suivants suggérés
- ✗ KPI cards (triple-shadow stack signature) — la page `admin` (dashboard) qui a le plus de KPI utilise `InterventionsClient`, refacto reportée
- ✗ Panels avec swatch navy + badge count — Phase 2
- ✗ Pills sémantiques (statut/priorité) — `StatutBadge` existant à migrer
- ✗ List items avec hover lift — Phase 2
- ✗ Table headers avec design tokens — beaucoup de tableaux encore en `bg-sand` raw

### Cleanup recommandé
- `bg-sand`, `bg-cream`, `bg-navy-pale`, `text-ink`, `text-ink-mid` etc. sont aliasés Tailwind. Migrer vers `var(--color-*)` partout pour cohérence absolue. Faisable en 1 sed-rule sur les fichiers déjà touchés.
- Plusieurs `[#hex]` subsistent dans : `admin/syndics/SyndicsClient.tsx` (modal), `admin/techniciens/TechniciensClient.tsx` (modal), `admin/utilisateurs/UtilisateursClient.tsx` (form). Phase 2.
- `admin/page.tsx` + `admin/InterventionsClient.tsx` + `admin/interventions/[id]/page.tsx` : refacto séparée recommandée (composant massif, ~3000+ lignes au total).

---

## Vérifications post-batch

- ✓ `tsc --noEmit` passe (EXIT=0) après chaque commit
- ✓ Tous les commits poussés sur `main` (origin)
- ✓ Aucun `<header>` orphelin (closing tags bien convertis)
- ✓ Aucune duplication de span (fix experts inclus)
- ✗ Test visuel en navigateur **non effectué** (CLI seulement) — recommandation utilisateur : `bun dev` puis check rapide sur les 30 routes

---

**Fin du sprint design-system Phase 1.** Prochain sprint suggéré : Phase 2 (KPI cards + panels + pills) ou refacto `InterventionsClient` (gros morceau isolé).
