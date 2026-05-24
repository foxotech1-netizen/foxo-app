# Audit — Refacto de `is_admin()` vers `utilisateurs.role = 'admin'`

- **Date de l'audit** : 2026-05-24
- **Auteur** : Claude (session FoxO) + Foxo
- **Statut** : audit lecture seule, AUCUN patch appliqué
- **HEAD git au moment de l'audit** : `62fdc9b`

## 1. Objectif

Cartographier le rayon de blast d'une éventuelle refacto de la fonction SQL `is_admin()` — actuellement basée sur une whitelist d'emails hardcodés — vers un lookup `utilisateurs.role = 'admin'`.

L'objectif final (non traité dans cette session) : avoir **une seule source de vérité** pour l'autorisation admin, alignée entre la couche RLS (DB) et la couche API (TS).

## 2. État actuel constaté

### 2.1 Définition SQL

Une seule définition dans tout `db/migrations/`, ligne 163 de `db/migrations/2026-05-11b_rls_core_dependencies.sql`. Aucune duplication, aucun drift entre fichier de migration et prod.

```sql
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select coalesce(
    auth.email() = any(array['info@foxo.be','foxotech1@gmail.com']::text[]),
    false
  );
$function$;
```

**Attributs déjà conformes** au standard hardening (Chantier #3) : `STABLE`, `SECURITY DEFINER`, `SET search_path TO 'public'`. Rien à durcir.

### 2.2 Usage SQL (policies RLS)

- **34 policies** sur **22 tables** consomment `is_admin()` (20 tables en schéma `public`, 5 policies dans `storage.objects`).
- **15 fichiers de migration** contiennent au moins une policy appelant `is_admin()`.
- Pattern dominant : `admin_all_<table>` (28 policies en CRUD complet admin).
- 6 policies plus granulaires : `notifications` (séparée par action), `agent_logs` / `automation_jobs` (SELECT-only admin), 3 policies `storage.objects` (documents + societe_assets).
- **Anomalie repérée** : la policy `tech insert notes-frais-photos` (storage) utilise `is_admin()` malgré son nom suggérant un rôle "tech". À investiguer dans le futur chantier (ou à archiver comme TODO séparé).

Liste complète des policies (récupérable via `SELECT … FROM pg_policies WHERE qual ILIKE '%is_admin%' OR with_check ILIKE '%is_admin%'`) : 34 lignes au moment de l'audit.

### 2.3 Usage TypeScript

- **Zéro appel SQL direct** à `is_admin()` depuis le code TS. Les 3 occurrences du token `is_admin` côté TS sont des **commentaires** descriptifs (`// RLS = is_admin` dans 2 routes facture).
- L'autorisation API-layer passe par `roleForEmail()` + constante `ADMIN_EMAILS` dans `src/lib/auth/roles.ts`. Cette constante contient **les mêmes 2 emails** que la fonction SQL.
- ~9 fichiers TS utilisent `isAdmin` (booléen dérivé de `roleForEmail()` côté API) ou en reçoivent comme prop UI.

### 2.4 État de la table `utilisateurs` en prod

```
| role       | nb |
|------------|----|
| syndic     | 1  |
| technicien | 2  |
```

- **3 utilisateurs au total**. **Zéro `admin`**.
- Les 2 emails hardcodés (`info@foxo.be`, `foxotech1@gmail.com`) **n'ont aucun compte** dans `utilisateurs` (vérifié par `SELECT … WHERE email IN (…)` → 0 rows).

## 3. Problème structurel identifié

Au-delà de la simple "whitelist hardcodée", l'audit révèle **deux systèmes d'autorisation parallèles** non synchronisés :

| Couche | Mécanisme | Source de vérité |
|---|---|---|
| **DB (RLS)** | `is_admin()` SQL | Whitelist `auth.email()` dans la fonction |
| **API (TS)** | `roleForEmail(user.email) === 'admin'` | Whitelist `ADMIN_EMAILS` dans `roles.ts` |

Aujourd'hui les deux whitelists contiennent les mêmes 2 emails. **Si l'une est modifiée sans l'autre**, les permissions divergent silencieusement. La colonne `utilisateurs.role` — qui devrait être la source unique — est **inutilisée** pour l'autorisation admin.

## 4. Plan de refacto (à appliquer dans un futur chantier)

La refacto ne se réduit PAS à un simple `CREATE OR REPLACE FUNCTION`. Séquencement en 3 étapes :

### Étape 1 — Création des comptes admin (migration data)

- Insérer `info@foxo.be` et `foxotech1@gmail.com` dans `utilisateurs` avec `role = 'admin'`.
- **Point délicat** : l'`id` doit matcher l'`id` de `auth.users` pour que `auth.uid()` fonctionne dans la future RLS basée sur `utilisateurs.role`. Pré-requis : ces deux emails doivent avoir un compte `auth.users` (au moins un login OTP effectué).
- Vérification pré-chantier suggérée : `SELECT id, email FROM auth.users WHERE email IN ('info@foxo.be', 'foxotech1@gmail.com')`.

### Étape 2 — Bascule SQL de `is_admin()`

- `CREATE OR REPLACE FUNCTION public.is_admin()` avec nouveau corps :

```sql
  SELECT EXISTS (
    SELECT 1 FROM public.utilisateurs
    WHERE id = auth.uid() AND role = 'admin'
  )
```

- Aucune policy à réécrire — la signature `boolean` ne change pas.
- **34 policies à re-tester** : c'est le gros du travail. Idéalement avec un compte admin de test + un compte non-admin, scan de chacune des 22 tables (CRUD selon la policy).

### Étape 3 — Bascule TS

- Remplacer la whitelist `ADMIN_EMAILS` + `roleForEmail()` par un lookup `utilisateurs.role` côté API.
- Impact sur ~9 fichiers TS.
- **Décision à prendre** : retirer complètement la whitelist email de `roles.ts`, ou la garder comme fallback transitoire pour roulage ?

## 5. Classification du chantier

**Moyen-gros** — à traiter dans une session dédiée. Pas un simple `CREATE OR REPLACE`.

| Phase | Effort | Risque |
|---|---|---|
| 1 — création comptes admin | faible | moyen (`auth.users` ↔ `utilisateurs.id`) |
| 2 — bascule SQL + tests RLS | moyen | élevé (34 policies, 22 tables) |
| 3 — bascule TS | moyen | faible (rayon de blast cartographié) |

Découpage suggéré : 3 commits, un par étape, avec validation manuelle entre chaque.

## 6. Pré-requis avant de démarrer le chantier

- [ ] Confirmer que `info@foxo.be` et `foxotech1@gmail.com` ont déjà un compte `auth.users` (sinon prévoir un login OTP au préalable).
- [ ] Décider si la whitelist `ADMIN_EMAILS` (TS) est retirée immédiatement ou maintenue comme fallback transitoire.
- [ ] Préparer un compte de test non-admin pour valider que les 34 policies refusent bien l'accès après refacto.
- [ ] Décider du sort de l'anomalie `tech insert notes-frais-photos` (storage) — refacto dans le même chantier ou TODO séparé.

## 7. TODOs latéraux découverts (non bloquants)

- Storage policy `tech insert notes-frais-photos` utilise `is_admin()` malgré son nom — à investiguer pour vérifier si c'est intentionnel (admin upload pour le compte du tech) ou un bug latent.
