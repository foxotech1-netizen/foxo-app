// Similarité de chaînes pour le matching d'ACPs (et autres entités
// nommées) par comparaison nom-extrait-IA → noms en base.
//
// Algorithme : Dice coefficient sur bigrammes après normalisation. Plus
// robuste que Levenshtein pour les noms d'immeubles courts à moyens
// car insensible à l'ordre des tokens et aux insertions/suppressions
// internes ("Résidence du Parc" ≈ "Le Parc, Résidence").
//
// Plage : [0, 1] où 1 = identique après normalisation.

// Normalise pour comparaison : lowercase, retire diacritiques (NFD →
// strip combining marks), retire ponctuation, collapse les espaces.
// Garde les tokens "ACP", "résidence", etc. mais sans casse ni accents.
export function normalizeForCompare(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')        // diacritiques (combining marks)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')           // ponctuation → espace
    .replace(/\s+/g, ' ')
    .trim();
}

// Génère l'ensemble des bigrammes (paires de caractères contigus) d'une
// chaîne. Pour les chaînes < 2 caractères, retourne un singleton avec
// la chaîne elle-même pour éviter une intersection vide systématique.
function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  if (s.length < 2) {
    if (s.length > 0) out.add(s);
    return out;
  }
  for (let i = 0; i < s.length - 1; i++) {
    out.add(s.slice(i, i + 2));
  }
  return out;
}

// Coefficient de Sørensen-Dice : 2·|A∩B| / (|A|+|B|). Travaille sur
// les bigrammes des chaînes normalisées. Renvoie 0 si l'une des deux
// est vide après normalisation.
export function diceCoefficient(a: string, b: string): number {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  if (na.length === 0 || nb.length === 0) return 0;
  if (na === nb) return 1;
  const A = bigrams(na);
  const B = bigrams(nb);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter += 1;
  return (2 * inter) / (A.size + B.size);
}

export interface ScoredCandidate<T> {
  candidate: T;
  score: number;        // ∈ [0, 1]
}

// Trouve le meilleur candidat parmi `candidates` selon le score Dice
// contre `query`. En cas d'égalité, garde le premier rencontré (ordre
// stable). Renvoie null si la liste est vide.
export function bestMatch<T>(
  query: string,
  candidates: T[],
  getName: (c: T) => string,
): ScoredCandidate<T> | null {
  if (candidates.length === 0) return null;
  let best: ScoredCandidate<T> | null = null;
  for (const c of candidates) {
    const score = diceCoefficient(query, getName(c));
    if (!best || score > best.score) best = { candidate: c, score };
  }
  return best;
}
