# État du projet FoxO — snapshot fin de session 2026-05-20

## ✅ CE QUI A ÉTÉ FAIT CETTE SESSION

### A1 — Bug 3 colonnes NULL sujet/expediteur/recu_le : LIVRÉ
- Migration versionnée `2026-05-19_mails_analyses_add_email_metadata_columns.sql` (commit `53e42d8`).
- Patch `analyse-deep/route.ts` peuple les 3 colonnes depuis `messages[0]` (commit `565e5a7`).
- Validation runtime : attendre prochain mail entrant + cron `*/30`. SQL de check :
  `SELECT thread_id, sujet, expediteur, recu_le, updated_at FROM mails_analyses WHERE updated_at > NOW() - INTERVAL '1 hour';`

### Sous-étape 1.a — Extraction occupants[] par Agent 1 : LIVRÉE
- Migration versionnée `2026-05-20a_mails_analyses_add_occupants_extraits.sql` (commit `9698d36`).
- Colonne `occupants_extraits jsonb` créée en prod via Supabase SQL Editor.
- Patch `analyse-deep/route.ts` (commit `05a8a3b`) :
  - Constante `ALLOWED_OCCUPANT_TYPES` (8 valeurs)
  - Interface `AnalyseDeepOccupant` (8 champs : prenom, nom, email, telephone, appartement, etage, type, remarques)
  - Extension `ClaudeAnalyse` avec `occupants?: AnalyseDeepOccupant[]`
  - Helper `normalizeOccupants(raw: unknown)` avec filtre permissif (contact / zone / identité)
  - System prompt étendu : entrée `occupants` au schéma + bloc règle (croisement CC↔occupants, types validés, contrainte anti-invention email)
  - `max_tokens` 1024 → 2048 (anticipation troncature avec liste d'occupants)
  - Champ `occupants_extraits: normalizeOccupants(analyse.occupants)` dans UPSERT
- Structure alignée sur `CronExtractedOccupant` de `check-mails.ts` → compatible direct avec `safeInsertOccupants` pour la sous-étape 1.c.
- Validation runtime : même attente qu'A1.

## 🗺 PLAN GLOBAL VALIDÉ — Chantier "Création intervention multi-occupants depuis un mail"

- **Étape 1** — Création intervention depuis mail
  - **1.a** ✅ FAIT — Extraction occupants par Agent 1
  - **1.b** ⏳ À FAIRE — UI `ConfirmCreateForm` avec liste éditable d'occupants (point d'entrée prochaine session)
  - **1.c** ⏳ À FAIRE — Endpoint `/api/admin/mails/confirm-and-create` écrit N occupants via `safeInsertOccupants`
- **Étape 2** — Envoi demandes confirmation aux occupants (mail Resend + SMS/WhatsApp Twilio)
- **Étape 3** — Rapport intervention (déjà en place en grande partie, à confirmer)
- **Étape 4** — Réponse Gmail au mail initial du syndic (reply-in-thread : `In-Reply-To` + `References`, réutiliser `thread_id` + `message_id` déjà stockés)

Décisions structurantes :
- **A3 abandonné** (refonte schéma `mails_analyses` avec champs ACP/syndic/etc.) → remplacé par séquence 1.a/1.b/1.c.
- **A4 abandonné** (cross-thread auto sur chaque mail) → reporté à étape 4 si volume justifie.
- **Pas de scan transversal de boîte sur chaque analyse** : Agent 1 travaille thread-by-thread (le thread Gmail contient assez d'info dans 90 % des cas — coût LLM maîtrisé).

## 🎯 PROCHAINE SESSION — POINT D'ENTRÉE

**Démarrer par la sous-étape 1.b — UI `ConfirmCreateForm` avec liste éditable d'occupants.**

Premier prompt = audit lecture seule de :
- Composant `ConfirmCreateForm` (chemin probable `src/components/mails/ConfirmCreateForm.tsx` — à confirmer)
- Comment il lit `mails_analyses` aujourd'hui (champs singuliers `occupant_telephone` / `occupant_email`)
- Composants UI réutilisables côté `/admin/planning` qui gèrent déjà multi-occupants (cf. `actions.ts` L420 : `allOccupants.map(...) → admin.from('occupants').insert(rows)`)

Patch UI : remplacer les champs singuliers par une liste éditable pré-remplie depuis `mails_analyses.occupants_extraits`, avec add/remove/edit par ligne et toggle `type_occupant`.

Ensuite enchaîner 1.c.

## 📋 BACKLOG NOTÉ AU FIL DE LA SESSION (hors séquence étape 1-4)

- **A2 (rétrogradé)** : investiguer `nb_errors: 2` préexistants sur mail `19e01b2488ac44bf` (Regimo Greenwood F4 demande_intervention). Curieux car `dossier_match_id IS NULL`. Probablement bug interne d'Agent 1.
- **Observabilité — filtres temporels** : ajouter sélecteur 1 semaine / 1 mois / 1 trimestre / 1 an sur `/admin/observabilite`. Toutes les métriques se filtrent dynamiquement.
- **Bug panorama mails "CLIENT = Hausman"** : l'UI lit `analyse_raw` directement, divergent des colonnes structurées. Devrait se résoudre naturellement en 1.b si on aligne l'UI sur `occupants_extraits`. Sinon patch cosmétique à prévoir.
- **Twilio prod config** : credentials manquants `.env.local`, rappels J-1 SMS no-op.
- **Backlog héritage** : dérive de schéma migrations vs prod (mon_role/mon_organisation_id sans STABLE/SET search_path), templates invoices/quotes, sidebar drag-and-drop.

## 🛠 ÉTAT DB / REPO POUR DÉMARRAGE PROCHAINE SESSION

- **HEAD** : `05a8a3b` (feat(mails): extract occupants[] in analyse-deep and store in occupants_extraits)
- **Branche** : `main`, working tree clean, aligné `origin/main`.
- **`mails_analyses`** : 7 rows existants. Nouvelles colonnes ajoutées cette session : `sujet`, `expediteur`, `recu_le`, `occupants_extraits`. Toutes nullables, toutes vides sur les rows pré-patch (seront remplies à la prochaine analyse fraîche).
- **Migrations versionnées du jour** (toutes appliquées en prod) :
  - `2026-05-19_mails_analyses_add_email_metadata_columns.sql`
  - `2026-05-20a_mails_analyses_add_occupants_extraits.sql`

## 🔁 RAPPEL PROTOCOLE

- Pre-push hook Husky `tsc --noEmit` actif (depuis commit `5c310d7`).
- Commits split par couche (db / mails / docs / etc.), conventional commits format.
- `ETAT_PROJET.md` (ce fichier) = source de vérité chargée au début de chaque session.
