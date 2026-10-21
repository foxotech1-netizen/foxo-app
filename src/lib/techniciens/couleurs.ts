// Couleur d'un technicien (utilisateurs.couleur) : valeur hexadécimale STOCKÉE
// et éditée par <input type="color"> — une donnée, pas un token de thème.
export const DEFAULT_TECH_COLOR = '#1B3A6B';
/** Valeur neutre proposée dans le sélecteur quand aucune couleur n'est définie. */
export const COULEUR_TECH_NEUTRE = '#888888';

/** Texte lisible (clair ou foncé) sur la couleur du technicien. */
export function readableTextColor(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return 'var(--color-cream)';
  const v = m[1];
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.6 ? 'var(--color-ink)' : 'var(--color-cream)';
}
