// Résolution des référentiels (ACP, syndics) pour les créations « à froid » :
// import Excel (/api/admin/import/encodage-froid) et reconstruction des
// dossiers depuis le miroir Odoo (odoo-reconstruction.ts).
//
// Règle commune : les référentiels existent déjà en base. On RÉSOUT, on ne
// crée jamais ni ACP ni organisation. Fonctions pures, aucun accès DB : les
// listes sont chargées par l'appelant.

import type { CreateFromSlotParticulier } from '@/app/admin/planning/actions';
import { normalise, normaliseNomAcp, resoudreAliasSyndic } from './encodage-froid';

export interface SyndicRow { id: string; nom: string; bce: string | null }
export interface AcpRow { id: string; nom: string; adresse: string | null; syndic_id_ref: string | null; bce: string | null }

export type Resolution<T> =
  | { ok: true; item: T; exact: boolean }
  | { ok: false; raison: string };

// ─── Résolutions référentiels (lecture seule, matching normalisé) ───────────

export function resoudreSyndic(nomFichier: string, syndics: SyndicRow[]): Resolution<SyndicRow> {
  const cible = normalise(resoudreAliasSyndic(nomFichier));
  const exacts = syndics.filter((s) => normalise(s.nom) === cible);
  if (exacts.length === 1) return { ok: true, item: exacts[0], exact: true };
  if (exacts.length > 1) {
    return { ok: false, raison: `syndic ambigu : ${nomFichier} (${exacts.map((s) => s.nom).join(', ')})` };
  }
  const partiels = syndics.filter((s) => {
    const n = normalise(s.nom);
    return n.includes(cible) || cible.includes(n);
  });
  if (partiels.length === 1) return { ok: true, item: partiels[0], exact: false };
  if (partiels.length > 1) {
    return { ok: false, raison: `syndic ambigu : ${nomFichier} (${partiels.map((s) => s.nom).join(', ')})` };
  }
  return { ok: false, raison: `syndic introuvable : ${nomFichier}` };
}

export function resoudreAcp(nomFichier: string, acps: AcpRow[]): Resolution<AcpRow> {
  const cible = normaliseNomAcp(nomFichier);
  const exacts = acps.filter((a) => normaliseNomAcp(a.nom) === cible);
  if (exacts.length === 1) return { ok: true, item: exacts[0], exact: true };
  if (exacts.length > 1) {
    return { ok: false, raison: `ACP ambiguë : ${nomFichier} (${exacts.map((a) => a.nom).join(', ')})` };
  }
  const partiels = acps.filter((a) => {
    const n = normaliseNomAcp(a.nom);
    return n.includes(cible) || cible.includes(n);
  });
  if (partiels.length === 1) return { ok: true, item: partiels[0], exact: false };
  if (partiels.length > 1) {
    return { ok: false, raison: `ACP ambiguë : ${nomFichier} (${partiels.map((a) => a.nom).join(', ')})` };
  }
  return { ok: false, raison: `ACP introuvable : ${nomFichier}` };
}

// ─── Demandeur particulier minimal (aucun syndic résolvable) ────────────────

/**
 * Placeholder : la source (fichier, facture) ne porte pas toujours d'e-mail
 * et createInterventionCold l'exige. Adresse interne, jamais notifiée
 * (création à froid = silencieuse).
 */
export const EMAIL_PLACEHOLDER_IMPORT = 'import-historique@foxo.be';

/** Adresse belge « Rue X 12, 1000 Bruxelles » → { cp, ville } best-effort. */
export function extraireCpVille(adresse: string): { cp: string; ville: string } {
  const m = adresse.match(/\b(\d{4})\s+([^,;]+?)\s*$/);
  return { cp: m?.[1] ?? '0000', ville: (m?.[2] ?? '—').trim() };
}

/** Ce que la source sait du demandeur ; chaque champ peut être vide. */
export interface SourceDemandeur {
  nom: string;
  email: string;
  tel: string;
  adresse: string;
}

export function demandeurParticulierMinimal(source: SourceDemandeur, acp: AcpRow | null): CreateFromSlotParticulier {
  const rue = source.adresse.trim() || acp?.adresse?.trim() || '—';
  const { cp, ville } = extraireCpVille(rue);
  return {
    demandeur_type: 'particulier',
    mandant: {
      prenom: 'Import',
      nom: acp?.nom || source.nom.trim() || 'Historique',
      email: source.email.trim() || EMAIL_PLACEHOLDER_IMPORT,
      tel: source.tel.trim(),
      adresse_facturation: { rue, code_postal: cp, ville },
    },
    lieu: { meme_que_mandant: true, rue, cp, ville },
    contact_sur_place: { actif: false },
  };
}
