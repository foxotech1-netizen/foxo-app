# InterventionsClient — refacto design system FoxO

**Date** : 2026-05-09
**Composant** : `src/app/admin/InterventionsClient.tsx` (3921 lignes)
**Composants liés refactorés** : `src/app/admin/Dashboard.tsx` (1024 lignes), `src/components/portal/SyndicMap.tsx` (98 lignes)
**TypeScript** : `tsc --noEmit` → **EXIT=0** sur chaque commit
**Commits** : 7, tous poussés sur `main`

---

## Résumé exécutif

Le composant `InterventionsClient`, qui était l'un des plus massifs de la codebase et qui alimentait deux routes (`/admin` dashboard ops + `/admin/interventions/[id]` page complète), a été refactoré sans toucher à la logique métier. Toutes les couleurs et typos passent désormais par les tokens FoxO. Le pattern visuel signature (triple-shadow stack, Sora pour titres/refs/KPIs, dot indicator, swatch navy 3px sur les panels) est appliqué de bout en bout.

**Les deux routes `/admin` et `/admin/interventions/[id]` consomment ce composant — elles bénéficient automatiquement de la refacto, sans changement dans leur server-side.**

---

## Sous-parties refactorées

### 1. Header + filtres (commit `ee716c1`)

| Avant | Après |
|---|---|
| `<header>` sticky bg-sand + h1 `text-xl font-extrabold` | `<div>` in-flow, `fxs-page-title` (Sora 300 + accent navy 600), border-b sand-border |
| Sous-titre `text-[11px] text-ink-muted capitalize` | Dot indicator navy + `var(--color-ink-mid)` |
| Tech filter active `bg-[#A17244]` | `bg-[var(--color-amber-foxo)]` |
| Search input `bg-cream` Tailwind alias | `bg-[var(--color-cream)]` token + `transition-colors` |
| Boutons filtre `font-bold` | `font-medium` (cohérent avec spec) |
| Banner erreur `border-[#E8C896] text-[#8A5A1A]` | Tokens `border-[var(--color-amber-foxo)]/30 text-[var(--color-amber-foxo)]` |

### 2. Tableau desktop + cards mobile (commit `b059afd`)

**Tableau** :
- Wrapper passe à `bg-[var(--color-cream)]` + triple-shadow stack inline (au lieu de `border + rounded-xl`)
- Refs des interventions en `font-sora text-xs font-semibold text-[var(--color-navy)] tracking-[0.01em]`
- `tracking-wider` → `tracking-[0.12em]` (spec) sur les headers de colonne
- Pills de statut/priorité passent toutes aux tokens (`var(--color-terra-light)`, `var(--color-terra-mid)`, `var(--color-amber-light)`, `var(--color-amber-foxo)`)
- Pill "Mail" : ne plus utiliser `bg-[#A17244] text-white` mais `bg-[var(--color-amber-light)] text-[var(--color-amber-foxo)]` (visuel plus discret, mieux intégré au tableau)
- Hover row : `hover:bg-[var(--color-sand-hover)]`

**Cards mobile** :
- Wrapper utilise les nouveaux utilitaires `.fxs-card` + `.fxs-card-hover` (lift -2px)
- Refs en `font-sora` semibold (était `font-mono font-bold`)
- Pills migrées tokens
- Bordures de séparation passent à `border-[var(--color-sand-mid)]`

### 3. Drawer (commit `86d9beb`)

- Drawer wrapper : `bg-[var(--color-navy-deep)]/45` au lieu de `bg-navy-deep/45` Tailwind alias (token explicite)
- Header drawer : ref en `font-sora font-semibold` navy, h1 ACP en `font-sora font-light tracking-tight`
- Tabs nav : `font-medium` au lieu de `font-bold` quand active
- **`Block` helper** : passe au pattern panel signature de la spec :
  - Triple-shadow stack au lieu de border simple
  - Swatch navy `w-[3px] h-3.5` à gauche du titre
  - Titre en Sora `tracking-[0.12em]` uppercase
- Boutons fermer/onglets : tokens `bg-[var(--color-sand-mid)]` + `transition-colors`

### 4. Purge hex mode clair (commit `b9a5eaf`)

Remplacements globaux dans tout le fichier (light mode seulement, dark mode intact) :

| Avant (hex) | Après (token) |
|---|---|
| `bg-[#A17244]` | `bg-[var(--color-amber-foxo)]` |
| `text-[#8A5A1A]` | `text-[var(--color-amber-foxo)]` |
| `border-[#E8C896]` | `border-[var(--color-amber-foxo)]/30` |
| `bg-[#1F6B45] text-white` | `bg-[var(--color-ok)] text-[var(--color-cream)]` |
| `accent-[#1B3A6B]` | `accent-[var(--color-navy)]` |
| `style={{ background: '#C4622D' }}` | `style={{ background: 'var(--color-terra)' }}` |
| `style={{ background: '#1F6B45' }}` | `style={{ background: 'var(--color-ok)' }}` |
| Pipebar suspens `bg-[#F7EDE5] border-[#E8C4AF]` | tokens terra-light + terra-mid |
| Counter-proposal badge `bg-[#D6E4F7] text-[#1B3A6B]` | tokens navy-light + navy |
| Bouton "Envoyer rapport au syndic" `hover:bg-[#8A613B]` | `hover:bg-[var(--color-amber-foxo)]/90` |
| Texte action requise `text-[#5A3F15]` | `text-[var(--color-amber-foxo)]` |

### 5. Dashboard.tsx — KPI / Todo / NewMail (commit `de63d8c`)

**`StatCard`** (remplace les KPI cards en haut du dashboard) — refait à neuf selon le spec KPI :
- Plus de barre 3px verticale à gauche → **dot indicator pastille** en haut-droite (22×22 + dot 6×6 dedans)
- Background pastille = teinte light du token sémantique (navy-pale, sky-light, terra-light, amber-light, sand-mid)
- Valeur KPI en **`font-sora text-3xl font-semibold` avec `letter-spacing: -0.04em`** (au lieu de la classe `kpi-value` legacy en Syne)
- Filtre actif → `ring-2 ring-amber-foxo/40` au lieu de border 2px directe
- Hover lift `-translate-y-0.5`

**`TodoCard`** (À faire aujourd'hui — Confirmées / Rapports / Occupants) :
- Header passe au pattern panel : swatch 3px coloré + titre Sora `font-medium` + badge count Sora dans pill ronde colorée (au lieu d'un header avec background pastel `#EFF6FF`/`#F0FDF4`/`#FFFBEB` qui masquait l'identité FoxO)
- Triple-shadow stack pour la card

**Bandeau urgent** (alerte interventions urgentes en attente) :
- Pattern alert spec : `bg-gradient-to-r from-terra-light` + `border-l-[3px] border-l-terra` + icône dans box terra cream 22×22
- Plus de hex hardcodé `#FFF5F5/#FCA5A5/#DC2626`

**`TECH_AVATAR_COLORS`** :
- Cycle de 4 couleurs avatar techs migré aux tokens FoxO (amber/navy/ok/terra) au lieu des hex `#A17244 #1B3A6B #1F6B45 #C4622D`

**`NewMailSection`** :
- Pill "Mail" passe à `bg-amber-light text-amber-foxo` (au lieu de `bg-[#C8924A] text-white`)
- Refs en Sora navy au lieu de `font-display text-[#C8924A]`
- Toast / progress bar : tokens
- Bouton supprimer modal : tokens terra

### 6. SyndicMap markers — palette FoxO (commit `4ef82d8`)

La carte Leaflet utilise CircleMarker avec `pathOptions` qui ne lit pas les CSS vars (canvas SVG), donc les hex sont dupliqués en haut du fichier avec des commentaires pointant vers les tokens correspondants.

**Mapping sémantique appliqué :**

| Statut | Avant (Tailwind palette) | Après (FoxO sémantique) |
|---|---|---|
| `nouvelle` | `#FBBF24` (amber 400) | `var(--color-amber-foxo)` (en attente d'action) |
| `confirmee` / `realisee` / `attente` | `#60A5FA` (blue 400) | `var(--color-navy)` (planifié) |
| `rapport` | `#34D399` (emerald 400) | `var(--color-ok)` (validé) |
| `cloturee` | `#9CA3AF` (gray 400) | `var(--color-ink-muted)` |
| Priorité urgente | `#F87171` (red 400) | `var(--color-terra)` |
| Bordure marqueur | `#fff` | `var(--color-cream)` |
| Popup texte titre | `#1B3A5C` | `var(--color-ink)` (font-weight 600) |
| Popup ref | `#60A5FA` | `var(--color-navy)` font-weight 600 |
| Popup type | `#6B7280` | `var(--color-ink-mid)` |
| Popup link | `#60A5FA` | `var(--color-navy)` font-weight 500 |

---

## Logique métier préservée

**Aucun changement comportemental.** Toutes les fonctions / state / handlers / mutations sont strictement intactes :

- Filtres (search, statut select, tech URL filter, recent_responses, acp_id) ✓
- Mutations (`updateInterventionStatus`, `assignTechnician`, `applyStatus`, `applySchedule`, `notifyOccupants`, `sendConfirmMail`, `acceptCounterProposal`, `reanalyzeMail`, `applyReanalysis`, `softDeleteRow`, `deleteIntervention`) ✓
- Optimistic updates de `rows` après chaque mutation ✓
- Drawer state (`selectedId`, `tab`, `formDraft`, `pendingStatut`, `pendingTechId`, `scheduleDate/Heure/CreneauId`, `notifySelectedIds`, `drawerOccupants`) ✓
- Auto-ouverture du drawer en mode `fullPage` via `initialSelectedId` ✓
- Navigation `router.push('/admin?tech=...')` depuis filtres tech ✓
- Lazy-load occupants au mount du drawer ✓
- Polling MessagesPanel ✓
- Stepper conditionnel `selected.source === 'mail'` ✓
- Bouton supprimer conditionnel selon le statut ✓

**Test recommandé** : ouvrir `/admin`, cliquer une ligne du tableau pour vérifier que le drawer s'ouvre, naviguer entre les onglets (Dossier / Suivi / Documents / IA / Historique). Tester sur mobile (cards layout). Tester `/admin/interventions/[id]` qui réutilise le même composant en mode pleine page.

---

## Fichiers touchés

| Fichier | Lignes modifiées (+/−) |
|---|---|
| `src/app/admin/InterventionsClient.tsx` | +118 / -111 |
| `src/app/admin/Dashboard.tsx` | +86 / -67 |
| `src/components/portal/SyndicMap.tsx` | +26 / -16 |

---

## Ce qui n'a PAS été refactoré (volontairement)

### Hex `dark:` variants

Les ~80 occurrences de `dark:bg-[#XXX]`, `dark:text-[#XXX]`, `dark:border-[#XXX]` dans `InterventionsClient.tsx` n'ont pas été touchées. Le design system FoxO ne spécifie que la palette mode clair (cf. `:root` dans globals.css) ; le mode sombre est une couche orthogonale qui mériterait sa propre passe avec sa propre table de tokens (`--color-ink-dark`, `--color-cream-dark`, etc.). Le faire à la volée ici aurait dépassé le scope.

### `INTERVENTION_COLORS` (palette ColorPicker)

Les 10 hex codés en dur (`#1B3A6B Bleu marine`, `#1F6B45 Vert`, etc.) sont **intentionnels** : ils servent d'identité visuelle par intervention (couleur d'étiquette dans le planning, validée serveur via une whitelist dans `/api/admin/interventions/[id]/color`). Les changer casserait le contrat avec la base. Ils sont commentés dans le code comme "palette de 10 couleurs alignée avec /api/admin/interventions/[id]/color".

### `StatCard` mort dans InterventionsClient.tsx

La fonction `StatCard` (lignes ~2467-2484) est dead code : elle n'est plus appelée depuis que les KPIs ont été déplacés dans `Dashboard.tsx`. Pas supprimée pour éviter d'élargir le PR — peut être nettoyée dans une passe `lint:dead-code` future.

### `kpi-value` / `premium-card` / `section-label` (classes globales)

Ces classes globales définies dans `globals.css` sont utilisées dans **`Dashboard.tsx`** (et ailleurs dans la codebase). `kpi-value` utilise Syne au lieu de Sora — j'ai contourné en remplaçant l'usage par `font-sora text-3xl font-semibold` directement dans `StatCard`. Migrer la classe globale serait un changement transversal qu'il vaut mieux faire en passe dédiée si l'objectif est d'éliminer Syne du dashboard.

---

## Régressions à tester manuellement

`tsc` reste vert mais les tests visuels suivants n'ont pas été lancés — à valider en local :

### Test #1 — `/admin` dashboard ops
1. Ouvrir la page : header "Tableau de **bord**" + date du jour + filtres tech actifs si présents
2. Vérifier les 5 KPI cards en haut : Nouvelles / En cours / En suspens / Rapports / Clôturées — chacune avec sa pastille colorée en haut-droite
3. Si interventions urgentes : bandeau alert terra avec icône Zap dans pillule
4. Section "À faire aujourd'hui" : 3 colonnes Confirmées / Rapports / Occupants avec swatch coloré + badge count Sora
5. Section "Nouvelles demandes mail" si présente : pill mail amber-light, refs Sora navy
6. Tableau desktop : refs en Sora, hover sand, pills mode clair sans hex
7. Click une ligne → drawer s'ouvre avec header refait

### Test #2 — Drawer intervention
1. Onglets Dossier / Suivi / Documents / IA / Historique : navigation OK, active = navy
2. Onglet Dossier : RefEditor, AcpPicker, OccupantEditCard, AcpSuggestionBanner, ReanalysisPanel rendent correctement
3. Onglet Suivi : MessagesPanel, FactureBlock, SMS list, status changer
4. Bouton "Envoyer rapport au syndic" : pill amber au lieu de marron pur
5. Modal soft-delete depuis l'icône poubelle de la ligne : bouton "Confirmer" terra
6. Modal hard-delete (statut nouvelle/attente/en_suspens) : bouton "Supprimer définitivement" terra

### Test #3 — `/admin/interventions/[id]` pleine page
1. URL avec un id valide → mode `fullPage=true`, drawer en pleine largeur (`max-w-[1100px]`)
2. Bouton "Fermer" affiche "← Retour" et redirige vers `/admin`
3. `initialSelectedId` ouvre auto le drawer

### Test #4 — Carte Leaflet
1. Sur `/admin` (carte au-dessus du tableau si interventions ont coords) — markers passent aux couleurs FoxO :
   - Jaune amber pour nouvelle
   - Navy pour confirmée/réalisée/attente
   - Vert ok pour rapport
   - Gris ink-muted pour clôturée
   - Terra pour priorité urgente
2. Popup au click : titre ink + ref navy mono + type ink-mid + lien navy

### Test #5 — Mobile (< 768px)
1. Tableau caché, cards mobile visibles
2. Hover lift (-2px) + ring navy si sélectionnée
3. Pills sémantiques cohérentes
4. Footer line count

---

## Commits granulaires

| Hash | Message | Lignes |
|---|---|---|
| `ee716c1` | header + filtres + search | +22 / -19 |
| `b059afd` | tableau desktop + cards mobile | +46 / -49 |
| `86d9beb` | drawer header + tabs + Block helper | +26 / -19 |
| `b9a5eaf` | purge hex hardcoded mode clair | +23 / -23 |
| `de63d8c` | Dashboard.tsx KPI/Todo/NewMail FoxO spec | +86 / -67 |
| `4ef82d8` | SyndicMap markers palette FoxO sémantique | +26 / -16 |
| `4778217` | dernier hex purge bandeau action requise | +1 / -1 |

**Total** : 7 commits, ~330 lignes touchées sur 5043 lignes total (3 fichiers).

---

## Avant / Après visuel

### KPI cards
- **Avant** : barre verticale 3px à gauche colorée par état (rouge `#DC2626` pour suspens, gris `#9A9690` pour clôturée), valeur en classe `kpi-value` Syne, "Voir tout" en `#C8924A` orange marron.
- **Après** : pastille discrete `22×22` avec dot `6×6` dedans en haut-droite, valeur en Sora 30px semibold avec `letter-spacing: -0.04em`, "Voir tout" en navy-mid. Filtre actif = ring amber autour de la card (au lieu d'override de border).

### Bandeau urgent
- **Avant** : box pastel rouge clair (`#FFF5F5`, border `#FCA5A5`, texte `#DC2626`) avec icône Zap en début de ligne.
- **Après** : gradient `from-terra-light to-rgba(247,237,229,0.3)` + barre verticale 3px terra à gauche + box `22×22` terra avec icône Zap en cream + chiffre en strong noir + texte terra. Même densité, mais identité FoxO (et donc lisible aussi en mode clair sans contraste agressif).

### Tableau
- **Avant** : `border + rounded-xl` Tailwind classique, refs en `font-mono`, pill mail en bloc plein `bg-[#A17244]`.
- **Après** : triple-shadow stack signature, refs en Sora semibold navy, pill mail amber-light pastel discrète. Le tableau "flotte" au lieu d'être encadré.

### Drawer
- **Avant** : Block helper en `border + rounded-xl` simple, titre en `font-bold tracking-wider`.
- **Après** : Block helper devient un panel signature (triple-shadow + swatch navy 3px), titre en `font-sora font-medium tracking-[0.12em]` cohérent avec la spec.

### Carte Leaflet
- **Avant** : palette Tailwind générique (amber 400 / blue 400 / emerald 400 / red 400 / gray 400) — donnait un rendu "carte de portail SaaS générique".
- **Après** : palette FoxO sémantique (amber-foxo / navy / ok / terra / ink-muted) — la carte parle le même langage visuel que le reste de l'app.

---

**Fin du sprint InterventionsClient.** Prochaine étape suggérée : sprint dark mode tokens (créer `--color-*-dark` dans `:root` puis purger les ~80 `dark:bg-[#XXX]` restants), ou sprint refacto `assistant/AssistantChat.tsx` + `MailStepper.tsx` + sub-blocks du drawer (RefEditor, OccupantEditCard, etc.) qui ont encore des `bg-white border-sand-border` Tailwind aliases au lieu de tokens.
