// Couleurs par défaut des créneaux du planning (réglables dans Paramètres).
// Source de vérité : DEFAULT_PLANNING_COLORS dans
// src/app/api/admin/parametres/planning-couleurs/route.ts (mêmes valeurs).
// Hex de DONNÉES (valeurs stockées dans parametres), pas des tokens de thème.
export const DEFAULT_PLANNING_COLORS = {
  libre: '#1F6B45',
  reserve: '#1B3A6B',
  bloque: '#6B7280',
  google: '#4338CA',
  foxo_importe: '#7C3AED',
} as const;

// Palette de repli si un technicien n'a pas de couleur personnalisée
// (utilisateurs.couleur IS NULL) — valeurs hex de données (mélangées en JS).
export const TECH_COLORS_FALLBACK = [
  { bg: '#1B3A6B', soft: '#D6E4F7' },  // navy
  { bg: '#A17244', soft: '#F0DCC4' },  // ambre
  { bg: '#1F6B45', soft: '#D4EDE2' },  // ok
  { bg: '#C4622D', soft: '#F7EDE5' },  // terra
] as const;

/** Hex #RRGGBB → version « soft » (mélange 20 % couleur / 80 % blanc). */
export function hexToSoft(hex: string): string {
  const m = hex.match(/^#([0-9A-Fa-f]{6})$/);
  if (!m) return TECH_COLORS_FALLBACK[0].soft;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const sr = Math.round(r * 0.2 + 255 * 0.8);
  const sg = Math.round(g * 0.2 + 255 * 0.8);
  const sb = Math.round(b * 0.2 + 255 * 0.8);
  return `#${[sr, sg, sb].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
