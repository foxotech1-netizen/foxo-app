// Whitelists et routage par rôle.
// Source unique de vérité — toute redirection ou autorisation passe par ici.

/**
 * Type `Role` — abstraction de ROUTAGE applicatif (3 valeurs :
 * 'admin' | 'tech' | 'partner'). Sert uniquement à décider où router
 * (`/admin`, `/tech`, `/portal`).
 *
 * Source du rôle :
 *   - 'admin' : dérivé de la DB (utilisateurs.role = 'admin') via
 *     isAdminUser() / roleForUser() / roleForUserId() dans
 *     `src/lib/auth/server.ts` — aligné avec la fonction SQL public.is_admin().
 *   - 'tech' / 'partner' : routage legacy via roleForEmail() ci-dessous
 *     (TECH_EMAILS, sinon 'partner').
 *
 * Ce type N'EST PAS un miroir de la colonne `utilisateurs.role` côté base.
 * Ne jamais comparer `utilisateurs.role` (enum Postgres `user_role`, 12 valeurs
 * incluant `'technicien'` et `'syndic'`) à `'tech'` ou `'partner'` :
 *   - `'tech'`   n'existe PAS dans l'enum DB (l'enum a `'technicien'`).
 *   - `'partner'` n'existe PAS dans l'enum DB.
 *
 * Voir `RoleUtilisateur` dans `src/lib/types/database.ts` pour le miroir TS
 * de la colonne DB (4 valeurs humaines : admin, syndic, courtier, technicien).
 *
 * Historique : ce trio de vocabulaires a été figé après le Chantier #4 (2026-05-24).
 */

export const TECH_EMAILS = [
  'tech1@foxo.be',
  'tech2@foxo.be',
] as const;

export type Role = 'admin' | 'tech' | 'partner';

// Routage legacy : dérive UNIQUEMENT 'tech' (via TECH_EMAILS) ou 'partner'.
// La dérivation 'admin' a été déplacée vers isAdminUser() / roleForUser() /
// roleForUserId() (src/lib/auth/server.ts), qui lisent utilisateurs.role
// (aligné avec la fonction SQL public.is_admin()). Encore consommée par les
// checks tech-only / tech||admin (un futur chantier 'tech routing' la retirera).
export function roleForEmail(email: string | null | undefined): Role {
  if (!email) return 'partner';
  const e = email.trim().toLowerCase();
  if ((TECH_EMAILS as readonly string[]).includes(e)) return 'tech';
  return 'partner';
}

// Sous-chemin local correspondant au rôle (utilisé en dev sans sous-domaine).
// En prod, le proxy ré-écrit admin.foxo.be → /admin, etc.
export function pathForRole(role: Role): string {
  switch (role) {
    case 'admin': return '/admin';
    case 'tech':  return '/tech';
    case 'partner': return '/portal';
  }
}
