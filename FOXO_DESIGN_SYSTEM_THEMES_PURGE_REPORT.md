# Sprint mono-thème FoxO — purge complète du système de thèmes

**Date** : 2026-05-10
**Décision** : Option 2 du rapport audit — simplification en un seul thème FoxO unique
**Commits** : 9 sur `main`, tous poussés
**TypeScript** : `tsc --noEmit` → **EXIT=0** sur chaque commit
**Logique métier** : 100 % préservée

---

## Fichiers modifiés (14)

| Fichier | Commit | Rôle |
|---|---|---|
| `src/app/admin/Dashboard.tsx` | `4581685` | TodoCards, RecentResponsesCard, NewMailSection — vars purgées |
| `src/app/admin/articles/ArticlesClient.tsx` | `81b0be1` + `1d43733` | tableau wrapper |
| `src/app/admin/facturation/FacturationListClient.tsx` | `81b0be1` + `1d43733` | chips filtres + section status |
| `src/app/admin/notes-frais/NotesFraisClient.tsx` | `81b0be1` | tableau wrapper |
| `src/app/admin/parametres/ParametresClient.tsx` | `a762940` + `77ffe65` + `81c5a61` | sticky tabs + retrait ThemePicker + 1 occurrence orpheline |
| `src/app/admin/home/page.tsx` | `a762940` | hero gradient navy + tuiles cream + logo blanc |
| `src/app/tech/notes-frais/NotesFraisTechClient.tsx` | `a762940` | header h1 Sora + p ink-mid |
| `src/app/portal/page.tsx` | `a762940` | StatCard label |
| `components/Sidebar.tsx` | `f142e70` | gradient navy fixe + retrait ThemeSelector + barre sky-foxo active |
| `src/app/portal/PortalNav.tsx` | `f142e70` + `8052d8a` | mobile header navy + retrait ThemeToggle |
| `src/app/tech/layout.tsx` | `f142e70` | header navy + retrait ThemeToggle |
| `src/app/admin/layout.tsx` | `8052d8a` | retrait topbar (qui ne contenait que ThemeToggle) |
| `src/app/layout.tsx` | `8052d8a` | retrait `<ThemeApplier />` + `<script THEME_INIT_SCRIPT />` |
| `src/app/globals.css` | `81c5a61` | purge vars legacy + classes `.premium-card`/`.section-*`/`.kpi-value`/`.row-hover` rebasées sur tokens FoxO directs |

---

## Fichiers supprimés (7)

| Fichier | Lignes |
|---|---|
| `src/components/ThemeApplier.tsx` | 194 |
| `src/components/ThemeSelector.tsx` | 53 |
| `src/components/ThemeToggle.tsx` | 91 |
| `src/components/ThemePicker.tsx` | 126 |
| `src/components/ThemeProvider.tsx` | 15 (stub) |
| `src/lib/themes.ts` | 106 |
| `src/app/admin/parametres/theme-actions.ts` | 56 |

**Total supprimé** : 641 lignes de plomberie thèmes (composants + types + server actions).

---

## Lignes de code supprimées

| Source | Net |
|---|---|
| Composants thèmes supprimés (7 fichiers) | -641 |
| Imports + JSX résiduels (admin layout, root layout, PortalNav, Sidebar, tech layout, parametres) | ~ -68 |
| Vars legacy purgées dans globals.css (--page-bg, --card-radius, --card-shadow*, --text-primary/secondary/muted, --accent-admin/portal, --sidebar-bg/logo-bg/logo-fg, --tech-* aliases) | ~ -27 |
| **Net total** | **~ -700 lignes** |

(Conforme à l'estimation du rapport audit : ~600 lignes ; +100 sur le compteur exact dû à la purge des classes CSS legacy en plus.)

---

## Tests visuels recommandés

### Sidebar admin (desktop)
- Background gradient navy-dark → navy-deep (vs ancien selon thème)
- Logo blanc fixe
- Items navigation : cream/65 inactif, cream actif avec **barre verticale 2px sky-foxo** (pattern signature ajouté)
- Badges Alertes (terra avant) → **amber-foxo** + cream
- Footer : juste "Déconnexion" (pas de sélecteur thème)

### Sidebar admin (mobile)
- Header fixe top : gradient navy au lieu du sable doré legacy
- Label "Interface Admin" : cream/55 (vs sable foncé)
- Bottom-nav : gradient navy (vs gradient brun #2C2A24)
- Plus de bouton ThemeToggle dans le header mobile

### Sidebar portal (desktop + mobile)
- Bouton ThemeToggle disparu du sidebar footer (desktop) et du mobile header
- Header mobile : navy au lieu de --sidebar-logo-bg
- Bouton Déconnexion : cream/65 (vs #8A8278 sable)

### Tech header
- Background : navy gradient au lieu de --sidebar-logo-bg dynamique
- Subtitle "Technicien" : cream/55 (vs #7A6A50)
- Bouton Déconnexion : cream/65 + plus de ThemeToggle à côté
- Logo blanc fixe

### Admin topbar
- **N'existe plus** — la div sticky 40px qui contenait le ThemeToggle a été retirée. Le MainContent occupe désormais toute la hauteur.

### Admin /home (mosaïque tuiles)
- Hero zone : gradient navy au lieu de var(--hero-bg) sable
- Logo : blanc au lieu de noir (cohérent avec le nouveau fond navy)
- Section-label "FoxO · Interface Admin" : cream/65
- Tuiles : cream + triple-shadow stack signature (vs box-shadow legacy via vars)
- Tuile titles : Sora 600 ink (vs font-syne 700 --text-primary)
- Badges tuiles : terra+cream (vs hex #E53935 rouge)

### Admin /parametres section "Apparence"
- ThemePicker disparu — il reste juste "Couleurs du planning" (palette créneaux)
- Sticky tabs : tokens FoxO directs (cream-mid bg, sand-border)

### Admin /Dashboard (TodoCards + RecentResponses + NewMail)
- TodoCards items : bg-sand + border-sand-mid (vs --main-bg + --card-border-2)
- Cards wrappers : cream + sand-border (vs vars dynamiques)
- NewMailSection : pill mail amber-light, refs Sora navy

### Tableaux Articles / Facturation / Notes-frais
- Wrapper : cream + sand-border explicite
- En-tête tableau : sand (vs --table-bg)

### /admin/hub launcher (gradient sombre intentionnel)
- Intact

### /app-hub + /go-hub (gradient navy)
- Intacts (logo 144/160/200px déjà bumpé)

### Tests fonctionnels
- Naviguer entre /admin, /tech, /portal — vérifier que **le rendu reste identique** quel que soit la page (plus de différenciation thématique)
- Vérifier qu'aucune erreur runtime n'apparaît au mount (suppression du `<ThemeApplier />` et `THEME_INIT_SCRIPT`)
- Vérifier qu'aucun bouton/sélecteur de thème n'est visible nulle part (admin topbar, sidebars, parametres)
- Tester le mode dark OS (prefers-color-scheme: dark) — vérifier qu'il n'y a plus d'effet "tableau brun foncé" type AddressAutocomplete (tous les `dark:` variants restants sont neutralisés par l'absence de fond color-scheme dark)

---

## Migration Supabase à faire manuellement

La table `user_preferences` (avec colonne `theme`) devient orpheline — plus aucun code ne la lit ni n'y écrit.

### Décision recommandée : **DROP TABLE**

**Justification** :
- 0 consommateur restant dans la codebase
- La fonctionnalité de personnalisation thème est définitivement retirée
- Garder une table inutilisée crée de la dette de schéma + sync RLS à maintenir
- Si Christophe relance plus tard une feature de personnalisation (ex: planning compact vs aéré, ou layout 2-cols vs 3-cols), une nouvelle table dédiée sera créée avec un schéma propre

### Script SQL à exécuter (Supabase SQL Editor)

```sql
-- À exécuter manuellement par Christophe via le SQL Editor Supabase.
-- Idempotent : safe si la table n'existe pas (migration jamais appliquée).
DROP TABLE IF EXISTS public.user_preferences;
```

### Alternative : conserver vide

Si Christophe préfère garder l'option de la réutiliser dans un futur sprint personnalisation :

```sql
-- Vide la table mais garde le schéma. Aucun code ne lit/écrit dedans
-- depuis le sprint mono-thème — RLS et trigger restent inactifs.
TRUNCATE TABLE public.user_preferences;
COMMENT ON TABLE public.user_preferences IS
  'ORPHELINE depuis sprint mono-thème FoxO 2026-05-10 — colonne theme plus
   consommée. À drop ou réutiliser pour future feature personnalisation.';
```

---

## Régressions potentielles surveillées

### À tester en priorité
1. **Auth login** (`/auth/login`) — page sur fond sable doré, n'a jamais consommé les vars de thème. Doit rester intacte.
2. **Mode dark OS** — l'utilisateur en dark mode n'a plus le `<script THEME_INIT_SCRIPT />` qui posait des CSS vars au mount. Comportement attendu : page affichée en sand FoxO (palette mode clair fixe). Le `color-scheme: light` dans `:root` indique au navigateur d'utiliser le rendu clair pour les form controls natifs.
3. **PWA tech offline** — le service worker pourrait avoir cached l'ancien CSS avec les vars de thème. Au premier reload après deploy, ça devrait se purger. Sinon force-refresh dur pour les techs sur le terrain.
4. **Sidebar mobile admin** — le header mobile utilise désormais une couleur de label cream/55 sur fond navy. Vérifier le contraste au soleil.

### Non-régressions confirmées par grep
- ✅ Plus aucun import `from '@/lib/themes'` dans la codebase
- ✅ Plus aucun import `from '@/components/Theme*'` dans la codebase
- ✅ Plus aucune utilisation de `useTheme`, `applyTheme`, `setTheme`, `getCurrentTheme`, `subscribeThemeChange`, `THEME_INIT_SCRIPT`
- ✅ Plus aucune var dynamique de thème consommée hors `globals.css` (qui ne contient plus que les commentaires de purge)
- ✅ `tsc --noEmit` vert sur chaque commit (pas de référence cassée)

### Garde-fous PWA / theme-color metadata
- `src/app/tech/layout.tsx` : `viewport.themeColor: '#1B3A6B'` (navy hardcodé) — préservé, conforme au nouveau gradient navy
- `src/app/manifest.ts` : icônes PWA — non touchées

### Tokens conservés
- `--accent-tech: #34D399` (vert PWA tech) — token identitaire séparé, conservé volontairement. Distinct de la palette sémantique FoxO. Utilisé sur : refs missions, swatches panels intervention, focus inputs tech, bottom-nav PWA, app-hub/go-hub iconColor pour la tuile FoxO Tech.
- Toute la palette FoxO `:root` (--color-sand/cream/ink/navy/terra/amber-foxo/ok/sky-foxo et leurs variantes light/mid/pale) — c'est l'identité unique restante.

---

## Commits chronologiques

1. `4581685` — Dashboard.tsx
2. `81b0be1` — articles/facturation/notes-frais (1ère passe — only NotesFraisClient touché car articles/FacturationList non lus initialement)
3. `1d43733` — articles/facturation finis (re-read + edit)
4. `a762940` — parametres + admin/home + tech notes-frais + portal/page
5. `f142e70` — sidebar admin/portal/tech header → gradient navy fixe
6. `77ffe65` — retire ThemePicker section dans /admin/parametres
7. `8052d8a` — supprime 7 fichiers thèmes + adapte root/admin/portal/tech layouts (-709 lignes nettes)
8. `81c5a61` — nettoie globals.css (vars purgées + classes premium rebasées)

---

**Fin du sprint mono-thème FoxO.** L'app a désormais une identité visuelle unique (sand/cream/ink/navy/terra/amber-foxo/ok/sky-foxo + accent-tech vert PWA). La sidebar admin = sidebar portal = TechHeader = même gradient navy permanent. Plus aucun sélecteur de thème, plus aucune var dynamique injectée au runtime, plus de `<script>` blocking au mount. Le système est radicalement simplifié, ~700 lignes de plomberie sont parties.
