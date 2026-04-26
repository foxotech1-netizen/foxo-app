// Whitelists et routage par rôle.
// Source unique de vérité — toute redirection ou autorisation passe par ici.

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
