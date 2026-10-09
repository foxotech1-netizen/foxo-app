// Pré-remplissage « création depuis un mail » : posé dans sessionStorage par
// /admin/mails (menu « ⋯ → Créer une intervention »), lu par /admin/planning
// (ouverture de « Proposer un créneau », puis fenêtre de création).
//
// Module sans dépendance, utilisable uniquement côté navigateur.

export const MAIL_PREFILL_KEY = 'foxo_mail_prefill';
// Marqueur « la proposition de créneau a déjà été ouverte pour ce
// pré-remplissage » — évite une ré-ouverture automatique à chaque visite.
export const MAIL_PREFILL_PROMPTED_KEY = 'foxo_mail_prefill_prompted';

// Au-delà, le pré-remplissage est considéré abandonné : il ne doit pas
// ressortir dans une création sans rapport, plus tard dans le même onglet.
const MAIL_PREFILL_TTL_MS = 15 * 60_000;

/**
 * Renvoie le JSON brut du pré-remplissage s'il est encore valable, sinon null.
 * Un pré-remplissage périmé est effacé au passage. Les entrées sans
 * `created_at` (format antérieur) sont acceptées telles quelles.
 */
export function readFreshMailPrefillRaw(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const ss = window.sessionStorage;
    const raw = ss.getItem(MAIL_PREFILL_KEY);
    if (!raw) return null;
    const createdAt = (JSON.parse(raw) as { created_at?: unknown }).created_at;
    if (typeof createdAt === 'number' && Date.now() - createdAt > MAIL_PREFILL_TTL_MS) {
      ss.removeItem(MAIL_PREFILL_KEY);
      ss.removeItem(MAIL_PREFILL_PROMPTED_KEY);
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}
