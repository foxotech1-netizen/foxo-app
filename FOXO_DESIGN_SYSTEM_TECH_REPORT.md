# Sprint Tech — refacto FoxO mobile-first

**Date** : 2026-05-09
**Périmètre** : portail `tech.foxo.be` (4 pages + 6 panels intervention détail)
**Commits** : 8 sur `main`, tous poussés
**TypeScript** : `tsc --noEmit` → **EXIT=0** sur chaque commit

---

## MainContentTech créé

**Fichier** : `components/layout/MainContentTech.tsx` (47 lignes)

**Patterns appliqués** :
- `<main>` sémantique, `mx-auto w-full max-w-[640px]` (cible tactile centrée)
- `padding-bottom: calc(90px + env(safe-area-inset-bottom, 0px))` — réserve pour TechBottomNav iOS
- `padding: 16px` sur les côtés (vs 24px en admin) — maximise la surface tactile
- `padding-top: 16px` (espace après TechHeader sticky)
- `min-height: 100vh` + `flex-1` — occupe toute la hauteur entre header/bottom-nav
- Background : `var(--color-sand)` + un seul radial gradient `sky-foxo` top-center 50%/0% (sobriété mobile vs 2 gradients admin)
- Doc inline + commentaire d'usage dans `tech/layout.tsx`

---

## tech/layout.tsx intégré (commit `07aa4c2`)

**Diff résumé** :

```diff
- <main className="flex-1 px-4 py-4 max-w-[640px] mx-auto w-full"
-   style={{ paddingBottom: 'calc(90px + env(safe-area-inset-bottom, 0px))' }}>
-   {children}
- </main>
+ <MainContentTech>{children}</MainContentTech>
```

**Préservé strictement** :
- TechHeader sticky 64px (sibling, intact, identité PWA)
- TechBottomNav fixed bottom (sibling, intact)
- PWARegister (Service Worker)
- Auth gating + ping `last_seen_at`
- safe-area-inset-bottom (déplacé dans MainContentTech)
- max-w-640 mx-auto (déplacé dans MainContentTech)

**Bonus** : bouton Déconnexion bumpé à `min-h-[44px]` (cible tactile Apple HIG).

---

## Tokens `--tech-*` réconciliés (commit `9807ee4`)

| Token tech | Valeur littérale avant | Référence FoxO après |
|---|---|---|
| `--tech-bg` | `#F5F2EC` | `var(--color-sand)` |
| `--tech-card` | `#FDFBF7` | `var(--color-cream)` |
| `--tech-card-mid` | `#EDE8DF` | `var(--color-sand-mid)` |
| `--tech-text` | `#1C1A16` | `var(--color-ink)` |
| `--tech-text-mid` | `#6B6558` | `var(--color-ink-mid)` |
| `--tech-text-mute` | `#A09A8E` | `var(--color-ink-muted)` |
| `--tech-border` | `#DDD8CC` | `var(--color-sand-border)` |

Les valeurs étaient strictement identiques aux tokens FoxO — la réconciliation casse le fork visuel sans changer le rendu. Permet aux composants tech historiques de continuer à tourner sans modification, tout en garantissant l'alignement sur la palette FoxO. Les nouveaux composants tech utilisent directement `var(--color-*)`.

**Variables conservées intentionnellement** :
- `--accent-tech: #34D399` (vert tech) — accent identitaire du portail tech, distinct des couleurs sémantiques FoxO. Ne mappe à rien de strictement équivalent dans la palette FoxO (`--color-ok` est `#1F6B45`, plus foncé). Utilisé dans tous les fichiers tech via `var(--accent-tech)`.

---

## Pages refactorées

| Page / Composant | Statut | Commit |
|---|---|---|
| `components/layout/MainContentTech.tsx` | ✓ créé | `2d52aa8` |
| `src/app/tech/layout.tsx` | ✓ refacto (intégration MainContentTech + cible tactile Déconnexion) | `07aa4c2` |
| `src/app/globals.css` | ✓ tokens --tech-* réconciliés | `9807ee4` |
| `src/app/tech/page.tsx` (dashboard) | ✓ refacto | `3d9c919` |
| `src/app/tech/historique/page.tsx` + `HistoriqueClient.tsx` | ✓ refacto | `6c7cac8` |
| `src/app/tech/notes-frais/NotesFraisTechClient.tsx` | ✓ refacto | `0856551` |
| `src/app/tech/interventions/[id]/page.tsx` | ✓ refacto | `b6b4b78` |
| `src/app/tech/interventions/[id]/TimerPanel.tsx` | ✓ refacto + couleur dynamique selon durée | `b6b4b78` |
| `src/app/tech/interventions/[id]/NotesPanel.tsx` | ✓ refacto | `b6b4b78` |
| `src/app/tech/interventions/[id]/PhotosPanel.tsx` | ✓ refacto + cibles tactiles bumpées | `b6b4b78` |
| `src/app/tech/interventions/[id]/ObservationsPanel.tsx` | ✓ refacto + photos 80x80 (vs 60) | `b6b4b78` |
| `src/app/tech/interventions/[id]/RapportPanel.tsx` | ✓ refacto (header + brief + sections + boutons) | `b6b4b78` |
| `src/app/tech/interventions/[id]/PaiementPanel.tsx` | ✓ refacto (3 states) + boutons +/- 44x44 | `b6b4b78` |

---

## Composants partagés modifiés

Aucun. Les composants partagés admin/tech/portal (`StatutBadge`, `QrPaiement`, `Logo`, `ThemeToggle`, `PWARegister`) n'ont pas été touchés — refacto strictement scopé au portail tech.

---

## Pages skippées

Aucune. Toutes les pages du portail `tech.foxo.be` ont été refactorées :

- `/tech` (dashboard) ✓
- `/tech/historique` ✓
- `/tech/notes-frais` ✓
- `/tech/interventions/[id]` (page + 6 panels) ✓

**TechBottomNav** (`src/app/tech/TechBottomNav.tsx`) : intacte par instruction explicite ("STRICTEMENT INTACTES"). Le composant utilise déjà des cibles tactiles 58px (au-dessus du seuil 44px Apple HIG) et l'accent vert `#34D399` qui est l'identité PWA.

---

## Patterns appliqués (synthèse)

### Cards (toutes les sections)
- `bg-[var(--color-cream)]`
- `rounded-xl` (12px, vs 10px en admin pour respiration tactile)
- Triple-shadow stack inline `0 1px 2px / 0 4px 12px / 0 0 0 1px` (signature)
- `padding: 16-20px` (vs 12-18 admin)
- `space-y-3` entre cards (vs 2-2.5 admin)

### Headers de cards (pattern panel signature)
- Swatch `w-[3px] h-3.5 rounded-sm bg-[var(--accent-tech)]`
- Label en `font-sora text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-ink-mid)]`
- Action button à droite (Ajouter / Modifier) en `min-h-[44px]`

### Typographie tech (+1px partout vs admin)
- H1 page : Sora 24px 600 (vs 22px admin)
- H1 carte ACP : Sora 22px 600
- Body : 14px Inter (vs 13px admin)
- Labels uppercase : 11px Inter 500 tracking-[0.12em] (vs 10px admin)
- Refs : Sora 12px 600 tracking-[0.01em] var(--accent-tech)
- Chiffres KPI / Timer : Sora 28px 600 letter-spacing -0.02em
- Hero gradient (Bonjour) : Sora 24px 600 cream

### Cibles tactiles
- Tous boutons primaires : `min-h-[48px]` + `py-3` ou `py-3.5`
- Boutons secondaires / icônes : `min-h-[44px]` + `min-w-[44px]`
- Liens dans le texte : `min-h-[44px]` (zone de tap élargie)
- Inputs / textarea : `min-h-[44px]` + `px-3.5 py-3`
- Boutons +/- catalogue Paiement : 44x44 (étaient 28x28)
- Photos thumbnails Observations : 80x80 (étaient 60x60)

### Contraste terrain
- Adresses, types, valeurs métier → `text-[var(--color-ink)]` (foncé)
- Labels purs et hints → `text-[var(--color-ink-mid)]` (gris)
- `text-[var(--color-ink-muted)]` réservé aux éléments tertiaires (timestamps relatifs, placeholders)

### States sémantiques
- Timer en cours : couleur dynamique selon durée
  - < 1h → `var(--accent-tech)` (vert)
  - 1h-2h → `var(--color-amber-foxo)` (alerte)
  - > 2h → `var(--color-terra)` (urgent)
- Pills statut intervention :
  - Urgent → `terra-light + terra + terra-mid`
  - En cours → `amber-light + amber-foxo + amber-foxo/30`
  - Terminée → `ok-light + ok + ok-mid`
- Toast feedback : tokens FoxO (ok/amber/terra), zéro hex
- Banner offline / queue photos : amber/navy tokens
- Photo upload zone (notes-frais) : `border-dashed amber-foxo/40 + bg-amber-light/40` (CTA visible terrain)

### Active feedback tactile
- Cards cliquables (missions, notes) : `active:scale-[0.99]` (subtil, donne le feedback de tap sans casser le hit-target)
- Photos miniatures : `active:scale-[0.97]` (un peu plus marqué)

---

## Hex hardcodés conservés (justifiés)

| Fichier | Hex | Justification |
|---|---|---|
| `tech/page.tsx` | `linear-gradient(180deg, #0d2318 0%, #1a3d2a 100%)` | Hero "Bonjour" identité PWA verte sombre — design intentionnel hors palette FoxO (idem launcher `/admin/hub`) |
| `tech/layout.tsx` | `themeColor: '#1B3A6B'` | Metadata Next.js Viewport — doit être hex pur (PWA spec, pas de var CSS) |
| `tech/layout.tsx` | `text-[#7A6A50]` (sous-titre logo "Technicien") | Identité du logo, hors palette FoxO |
| `tech/layout.tsx` | `border-[rgba(0,0,0,0.12)]` (header bottom border) | Préservé tel quel — borderalpha générique |
| `tech/notes-frais/NotesFraisTechClient.tsx` | STATUT_BADGE.remboursee `#7C3AED / #F5F3FF` | Statut "remboursée" en purple — pas de token FoxO équivalent (sémantique post-validation hors flow standard) |
| `globals.css` | `--accent-tech: #34D399` | Token identité tech (vert) — distinct des sémantiques FoxO, gardé volontairement |

---

## Tests visuels recommandés

### Mobile réel (priorité 1)

1. **Safe-area iPhone notch** : ouvrir `/tech` sur iPhone (Safari/PWA) — vérifier que le contenu n'est pas masqué par la barre Dynamic Island en haut, ni la barre du bas (TechBottomNav respect le `env(safe-area-inset-bottom)`)
2. **TechBottomNav qui ne masque rien** : scroller jusqu'en bas d'une page longue (intervention détail, formulaire notes-frais) → le dernier élément reste visible (90px réservé)
3. **TechHeader sticky** : scroller dans `/tech/interventions/[id]` → le bandeau logo doit rester collé en haut
4. **Cibles tactiles 44px+ avec gants techniciens** :
   - `/tech` → cliquer une mission card avec le pouce
   - `/tech/interventions/[id]` → cliquer "Démarrer", "Clôturer", "Prendre des photos"
   - `/tech/interventions/[id]` Paiement → boutons +/- des articles (étaient 28x28, maintenant 44x44)
   - `/tech/notes-frais` → bouton "Toucher pour ajouter une photo" (zone amber dashed)
5. **Lisibilité extérieure (soleil)** :
   - Adresses, types d'intervention, occupants en `text-ink` foncé (vs gris avant)
   - Pills statut bien contrastées
   - Refs en vert tech (`--accent-tech`) bien visibles

### Fonctionnel (priorité 2)

1. **Timer intervention** : démarrer une intervention, attendre > 1h → vérifier que le timer passe à amber (mock difficile, à valider en prod)
2. **Upload photos hors-ligne** : couper le réseau, prendre une photo → vérifier le banner amber "Hors ligne" + queue IndexedDB
3. **Auto-save NotesPanel** : taper du texte, attendre 2s → status passe à "Sauvegardé hh:mm"
4. **QR EPC paiement** : générer une facture → vérifier le QR + form facturation

### Layout (priorité 3)

1. **max-w-640** sur tablette (iPad) : le contenu reste centré, ne s'étire pas
2. **Background sand + radial sky-foxo top-center** sur fond clair
3. **Hero gradient sombre** (Bonjour) : préservé identitaire
4. **Photos grid** : Observations 80x80, PhotosPanel 3 cols

---

## Régressions potentielles à surveiller

- **`premium-card` / `section-label` classes globales** : encore utilisées dans `Dashboard.tsx` admin (refactoré séparément avant). Pas touché ici. Si refacto futur, prévoir une passe globale.
- **`--card-bg`, `--card-border`, `--text-primary`, etc.** : variables historiques injectées par `ThemeApplier`. Encore référencées dans certains fichiers admin/tech historiques. Pas migrées dans ce sprint — fonctionnent toujours via les thèmes.
- **`bg-sand-mid`, `text-ink`, etc. (Tailwind aliases)** : co-existent avec les nouveaux `bg-[var(--color-sand-mid)]`. Pas migrées dans les fichiers tech car déjà mappées sur les mêmes tokens FoxO. Fonctionnel mais hétérogène.

---

## Commits chronologiques

1. `2d52aa8` — feat(design-system): MainContentTech wrapper mobile-first
2. `07aa4c2` — feat(design-system): integrate MainContentTech in tech/layout
3. `9807ee4` — refactor(design-system): tech tokens reconciliation with FoxO palette
4. `3d9c919` — refactor(design-system): tech dashboard page (FoxO patterns)
5. `6c7cac8` — refactor(design-system): tech historique page (FoxO patterns)
6. `0856551` — refactor(design-system): tech notes-frais page (FoxO patterns)
7. `b6b4b78` — refactor(design-system): tech intervention détail (page + 6 panels)

**Total** : ~600 lignes touchées sur ~3500 lignes total (8 fichiers tech + globals.css + MainContentTech).

---

**Fin du sprint Tech.** Prochaine étape suggérée : sprint dark mode tokens (créer `--color-*-dark` dans `:root` puis purger les ~80 `dark:bg-[#XXX]` restants dans le portail admin), ou refacto des classes globales `premium-card` / `section-label` / `kpi-value` pour éliminer le dernier vestige Syne dans Dashboard admin.
