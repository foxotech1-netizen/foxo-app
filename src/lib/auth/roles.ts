// Routage par rôle.
// Source unique de vérité — toute redirection passe par ici.

/**
 * Type `Role` — abstraction de ROUTAGE applicatif (3 valeurs :
 * 'admin' | 'tech' | 'partner'). Sert uniquement à décider où router
 * (`/admin`, `/tech`, `/portal`).
 *
 * Source du rôle : la DB (utilisateurs.role) via isAdminUser() / roleForUser() /
 * roleForUserId() / canAccessTechSpace() dans `src/lib/auth/server.ts` — aligné
 * avec la fonction SQL public.is_admin(). Le mapping enum DB → Role est :
 *   'admin' → 'admin' ; 'technicien' → 'tech' ; tout autre / absent → 'partner'.
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
 * La whitelist d'emails TECH_EMAILS / roleForEmail() a été retirée (lot sécurité
 * #10) au profit du rôle DB — voir canAccessTechSpace() dans auth/server.ts.
 */
export type Role = 'admin' | 'tech' | 'partner';

// Sous-chemin local correspondant au rôle (utilisé en dev sans sous-domaine).
// En prod, le proxy ré-écrit admin.foxo.be → /admin, etc.
export function pathForRole(role: Role): string {
  switch (role) {
    case 'admin': return '/admin';
    case 'tech':  return '/tech';
    case 'partner': return '/portal';
  }
}
