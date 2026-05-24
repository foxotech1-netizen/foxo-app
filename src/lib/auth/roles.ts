// Whitelists et routage par rôle.
// Source unique de vérité — toute redirection ou autorisation passe par ici.

/**
 * Type `Role` — abstraction de ROUTAGE applicatif.
 *
 * IMPORTANT : ce type a TROIS valeurs ('admin' | 'tech' | 'partner') et il est
 * dérivé de l'EMAIL de l'utilisateur via `roleForEmail()`. Il sert uniquement
 * à décider où router (`/admin`, `/tech`, `/portal`) et quel sous-domaine
 * activer (`SUBDOMAIN_FOR_ROLE`).
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

export const ADMIN_EMAILS = [
  'info@foxo.be',
  'foxotech1@gmail.com',
] as const;

export const TECH_EMAILS = [
  'tech1@foxo.be',
  'tech2@foxo.be',
] as const;

export type Role = 'admin' | 'tech' | 'partner';

export function roleForEmail(email: string | null | undefined): Role | null {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  if ((ADMIN_EMAILS as readonly string[]).includes(e)) return 'admin';
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

export const SUBDOMAIN_FOR_ROLE: Record<Role, string> = {
  admin:   'admin.foxo.be',
  tech:    'tech.foxo.be',
  partner: 'portal.foxo.be',
};
