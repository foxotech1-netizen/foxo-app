// Communication structurée belge (BBA / OGM-VCS).
// Format : +++DDD/DDDD/DDDDD+++ où les 12 chiffres significatifs ont un
// modulo 97 calculé sur les 10 premiers (reste = check digits, sauf 0 → 97).
//
// On dérive un BBA reproductible depuis le numéro de facture FoxO afin que
// l'import CSV Beobank puisse matcher les paiements sans état partagé.

const BBA_RE = /^\+\+\+(\d{3})\/(\d{4})\/(\d{5})\+\+\+$/;

function digitsFromString(s: string, length: number): string {
  // Garde uniquement les chiffres, complète à gauche par des 0, tronque
  // à `length` à droite (les chiffres les plus à droite sont conservés).
  const onlyDigits = s.replace(/\D/g, '');
  if (onlyDigits.length >= length) return onlyDigits.slice(-length);
  return onlyDigits.padStart(length, '0');
}

function bbaCheckDigits(tenDigits: string): string {
  // 10 chiffres max → max ≈ 1e10, bien sous Number.MAX_SAFE_INTEGER (≈ 9e15).
  // Pas besoin de BigInt (qui requiert ES2020).
  const n = parseInt(tenDigits, 10);
  const mod = n % 97;
  const check = mod === 0 ? 97 : mod;
  return String(check).padStart(2, '0');
}

// Génère "+++DDD/DDDD/DDDDD+++" pour un numéro de facture donné.
// Logique : on prend les 10 chiffres dérivés du numero (FV2026-014 → 2026014
// padded → 0002026014), puis on calcule le check digit modulo 97, total 12.
export function generateBBA(numero: string): string {
  const ten = digitsFromString(numero, 10);
  const check = bbaCheckDigits(ten);
  const twelve = ten + check;
  return `+++${twelve.slice(0, 3)}/${twelve.slice(3, 7)}/${twelve.slice(7, 12)}+++`;
}

// Parse une chaîne BBA et renvoie les 12 chiffres canoniques (ou null).
export function parseBBA(input: string): string | null {
  const trimmed = input.trim();
  // Format avec délimiteurs +++DDD/DDDD/DDDDD+++
  const m = trimmed.match(BBA_RE);
  if (m) return m[1] + m[2] + m[3];
  // Format brut 12 chiffres
  const onlyDigits = trimmed.replace(/\D/g, '');
  if (onlyDigits.length === 12) return onlyDigits;
  return null;
}

// Vérifie si une chaîne BBA est valide (check digits OK).
export function isValidBBA(input: string): boolean {
  const twelve = parseBBA(input);
  if (!twelve) return false;
  const ten = twelve.slice(0, 10);
  const check = twelve.slice(10, 12);
  return bbaCheckDigits(ten) === check;
}

// Formate 12 chiffres bruts vers la forme avec délimiteurs.
export function formatBBA(twelveDigits: string): string {
  if (!/^\d{12}$/.test(twelveDigits)) return twelveDigits;
  return `+++${twelveDigits.slice(0, 3)}/${twelveDigits.slice(3, 7)}/${twelveDigits.slice(7, 12)}+++`;
}
