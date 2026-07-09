// Helpers IBAN purs, sans dépendance ni effet de bord (donc testables et
// importables aussi bien côté serveur que côté client) : normalisation,
// validation FORMELLE + contrôle mod-97 (ISO 7064), et formatage lisible.
//
// Utilisés par l'extraction (marquer un IBAN douteux, confiance 0) et par le
// paiement fournisseur (QR EPC + contrôle anti-fraude au virement).

// Longueurs officielles par code pays (registre IBAN). Sert au contrôle
// formel : un IBAN d'un pays connu DOIT avoir la longueur attendue. Un pays
// absent de la table retombe sur la borne générique 15-34.
const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22,
  BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DK: 18, DO: 28,
  EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23,
  GL: 18, GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26,
  IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20,
  LV: 21, LY: 25, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30,
  NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22,
  SA: 24, SC: 31, SE: 24, SI: 19, SK: 24, SM: 27, ST: 25, SV: 28, TL: 23,
  TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20,
};

/** trim + MAJUSCULES + suppression des espaces, points et tirets. */
export function normalizeIban(raw: string | null | undefined): string {
  return (raw ?? '').replace(/[\s.\-]/g, '').toUpperCase();
}

/** Mod-97 (ISO 7064) sur l'IBAN réarrangé : les 4 premiers caractères passent
 *  en fin, chaque lettre est remplacée par sa valeur (A=10 … Z=35). Le reste
 *  doit valoir 1 pour un IBAN valide. Calcul par morceaux pour rester dans les
 *  entiers sûrs. */
function mod97(iban: string): number {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (let i = 0; i < rearranged.length; i += 1) {
    const code = rearranged.charCodeAt(i);
    // A-Z (65-90) → 10-35 ; 0-9 (48-57) → valeur numérique.
    const value = code >= 65 && code <= 90 ? code - 55 : code - 48;
    remainder = value > 9 ? (remainder * 100 + value) % 97 : (remainder * 10 + value) % 97;
  }
  return remainder;
}

/** Validation FORMELLE (2 lettres pays + 2 chiffres de contrôle + corps
 *  alphanumérique, longueur par pays si connue, sinon 15-34) suivie du
 *  contrôle mod-97. Retourne false pour tout IBAN vide, mal formé ou dont la
 *  clé de contrôle ne tombe pas juste. */
export function isIbanValid(raw: string | null | undefined): boolean {
  const iban = normalizeIban(raw);
  if (iban.length < 15 || iban.length > 34) return false;
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false;
  const expected = IBAN_LENGTHS[iban.slice(0, 2)];
  if (expected !== undefined && iban.length !== expected) return false;
  return mod97(iban) === 1;
}

/** Format lisible par blocs de 4 (« BE62 9502 6652 9861 »). */
export function formatIban(raw: string | null | undefined): string {
  return normalizeIban(raw).replace(/(.{4})/g, '$1 ').trim();
}
