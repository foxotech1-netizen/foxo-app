// Palette des couleurs d'intervention (planning / liste admin).
// Valeurs hexadécimales STOCKÉES en base (interventions.color) et validées
// par /api/admin/interventions/[id]/color (ALLOWED_COLORS) : ce sont des
// données, pas des tokens de thème — elles ne passent pas par var(--color-*).
export const INTERVENTION_COLORS = [
  { name: 'Bleu marine', hex: '#1B3A6B' },
  { name: 'Vert',        hex: '#1F6B45' },
  { name: 'Rouge',       hex: '#C4622D' },
  { name: 'Violet',      hex: '#7C3AED' },
  { name: 'Rose',        hex: '#DB2777' },
  { name: 'Jaune',       hex: '#D97706' },
  { name: 'Cyan',        hex: '#0891B2' },
  { name: 'Gris',        hex: '#6B7280' },
  { name: 'Indigo',      hex: '#4338CA' },
  { name: 'Emeraude',    hex: '#059669' },
] as const;
