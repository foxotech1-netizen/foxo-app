// Helpers de mapping ReportData partagés entre :
//   - src/app/api/tech/rapport-docx/route.ts (export DOCX brouillon tech)
//   - src/lib/rapport/dispatch.ts             (envoi email + upload Drive)
//
// Cible : produire un mapping cohérent avec le rapport modèle 2026-101 :
// objet court (1-2 lignes), adresse facturation multi-lignes (ACP+BCE,
// c/o syndic + contact, rue, CP+ville), adresse intervention (rue +
// nom ACP en ligne 1 + occupants typés en ligne 2), ref intelligente
// (Réf. dossier / Réf. syndic / Date intervention selon la donnée
// disponible).

import type { Acp, Intervention, Occupant, Organisation, Rapport, TypeOccupant } from '@/lib/types/database';
import { TYPE_OCCUPANT_LABEL } from '@/lib/types/database';

// Format date court FR (jj/mm/aaaa). Centralisé ici pour que la même
// chaîne soit utilisée partout (label "Date intervention", footer "Fait
// à Bruxelles le …", etc.).
export function fmtDateShort(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

const SEP_DASH = '  –  ';
const FALLBACK_OBJET = 'Recherche de fuite';
// Format "AAAA-NNNN" (réf interne FoxO, 4 chiffres après l'année).
// Tolérant : 2 à 4 chiffres après le tiret pour rétro-compat (ex. 2026-12).
const FOXO_REF_RE = /^\d{4}-\d{2,4}$/;

// ─── Objet du rapport ────────────────────────────────────────────────
//
// Règle : prendre la 1ʳᵉ ligne de rapport.degats si elle est < 200 chars
// (sert de résumé court de l'intervention). Sinon, fallback "Recherche
// de fuite" + adresse courte (ACP ou intervention).
export function buildObjet(
  rapport: Rapport | null,
  acp: Pick<Acp, 'adresse' | 'code_postal' | 'ville'> | null,
  iv: Pick<Intervention, 'adresse'>,
): string {
  const degats = (rapport?.degats ?? '').trim();
  if (degats) {
    const firstLine = degats.split(/\r?\n/)[0]?.trim() ?? '';
    if (firstLine.length > 0 && firstLine.length < 200) {
      return firstLine;
    }
  }
  const adresseCourte =
    acp?.adresse?.trim()
    || [acp?.code_postal, acp?.ville].filter(Boolean).join(' ').trim()
    || iv.adresse?.trim()
    || '';
  return adresseCourte ? `${FALLBACK_OBJET}${SEP_DASH}${adresseCourte}` : FALLBACK_OBJET;
}

// ─── Adresse facturation (4 lignes) ──────────────────────────────────
//
// Modèle 2026-101 :
//   Ligne 1 : "ACP MANNEKEN  –  BCE 0672.424.289"     (acp.nom + BCE acp)
//   Ligne 2 : "c/o Immo Gestion Syndic  –  Mme Caroline Mignon"
//                                                       (syndic + contact)
//   Ligne 3 : "Avenue de Fré 229"                       (rue du syndic)
//   Ligne 4 : "1180 Bruxelles"                          (CP + ville syndic)
//
// La table `organisations` n'a qu'un seul champ `adresse`. On parse côté
// code (regex CP belge 4 chiffres en queue de chaîne) pour séparer rue
// et CP+ville. Si le pattern ne matche pas, ligne 3 = adresse complète,
// ligne 4 = vide.
//
// Override : si `iv.nom_facturation` est saisi manuellement (rare), il
// remplace la ligne 1 (toute la ligne, pas juste le nom). Idem pour les
// emails / BCE de facturation override.
function splitSyndicAdresse(adresse: string | null): { rue: string; cpVille: string } {
  if (!adresse) return { rue: '', cpVille: '' };
  const trimmed = adresse.replace(/\s+/g, ' ').trim();
  if (!trimmed) return { rue: '', cpVille: '' };
  // CP belge = 4 chiffres en début de queue, suivi d'un nom de ville.
  const m = trimmed.match(/^(.*?)[,\s]+(\d{4}\s+[\p{L}\s\-']+)$/u);
  if (m) return { rue: m[1].trim().replace(/,$/, '').trim(), cpVille: m[2].trim() };
  return { rue: trimmed, cpVille: '' };
}

export interface FacturationLines {
  facturation_ligne1: string;
  facturation_ligne2: string;
  facturation_ligne3: string;
  facturation_ligne4: string;
}

export function buildFacturationLines(
  iv: Pick<Intervention, 'nom_facturation' | 'email_facturation' | 'bce_facturation'>,
  acp: Pick<Acp, 'nom' | 'bce'> | null,
  syndic: Pick<Organisation, 'nom' | 'adresse' | 'contact'> | null,
): FacturationLines {
  // Ligne 1 — ACP nom + BCE (override iv.nom_facturation prioritaire).
  const acpNomBce = acp?.bce && acp?.nom
    ? `${acp.nom}${SEP_DASH}BCE ${acp.bce}`
    : (acp?.nom ?? '');
  const facturation_ligne1 = (iv.nom_facturation?.trim()) || acpNomBce;

  // Ligne 2 — c/o Syndic + contact. Vide si pas de syndic.
  const facturation_ligne2 = syndic?.nom
    ? `c/o ${syndic.nom}${syndic.contact?.trim() ? SEP_DASH + syndic.contact.trim() : ''}`
    : '';

  // Lignes 3 & 4 — rue / CP+ville parsés depuis syndic.adresse.
  const { rue, cpVille } = splitSyndicAdresse(syndic?.adresse ?? null);

  return {
    facturation_ligne1,
    facturation_ligne2,
    facturation_ligne3: rue,
    facturation_ligne4: cpVille,
  };
}

// ─── Adresse intervention (2 lignes) ─────────────────────────────────
//
// Modèle 2026-101 :
//   Ligne 1 : "Rue de l'Étuve 50-52, 1000 Bruxelles  –  ACP MANNEKEN"
//   Ligne 2 (italique muted, géré par le builder) :
//     "Appartement E44 : Sarah Barbieux (sinistrée)  –
//      Appartement E54 : M. Tuna (source)"
//
// Pour la ligne 2, on utilise TYPE_OCCUPANT_LABEL (ex: 'occupant' →
// 'Occupant'). Pas de prefix M./Mme : la table occupants ne stocke pas
// de civilité.

export function buildAdresseInterventionLine1(
  acp: Pick<Acp, 'nom' | 'adresse' | 'code_postal' | 'ville'> | null,
  iv: Pick<Intervention, 'adresse'>,
): string {
  const cpVille = [acp?.code_postal, acp?.ville].filter(Boolean).join(' ').trim();
  const acpFullAddr = [acp?.adresse?.trim(), cpVille]
    .filter((s): s is string => !!s && s.length > 0)
    .join(', ');
  if (acp?.nom) {
    return acpFullAddr ? `${acpFullAddr}${SEP_DASH}${acp.nom}` : acp.nom;
  }
  return acpFullAddr || iv.adresse?.trim() || '';
}

export function buildAdresseInterventionLine2(
  occupants: ReadonlyArray<Pick<Occupant, 'appartement' | 'prenom' | 'nom' | 'type_occupant'>>,
): string {
  return occupants
    .map((o) => formatOccupant(o))
    .filter((s): s is string => s !== null)
    .join(SEP_DASH);
}

function formatOccupant(
  o: Pick<Occupant, 'appartement' | 'prenom' | 'nom' | 'type_occupant'>,
): string | null {
  const apt = o.appartement?.trim();
  const fullName = [o.prenom?.trim(), o.nom?.trim()].filter(Boolean).join(' ').trim();
  if (!apt && !fullName) return null;
  const aptPart = apt ? `Appartement ${apt}` : '';
  if (!fullName) return aptPart || null;
  const typeLabel = typeOccupantLabel(o.type_occupant);
  const namePart = typeLabel ? `${fullName} (${typeLabel.toLowerCase()})` : fullName;
  return aptPart ? `${aptPart} : ${namePart}` : namePart;
}

function typeOccupantLabel(t: TypeOccupant | null): string | null {
  if (!t) return null;
  return TYPE_OCCUPANT_LABEL[t] ?? null;
}

// ─── ref_label / ref_value ───────────────────────────────────────────
//
// Logique cascade :
//   1. reference_externe match "AAAA-NNNN" (réf interne FoxO)
//      → "Réf. dossier :" + valeur
//   2. reference_externe non vide (réf libre du syndic)
//      → "Réf. syndic :" + valeur
//   3. Aucune référence
//      → "Date intervention :" + creneau_debut formaté (ou today)
export function buildRefLabelValue(
  iv: Pick<Intervention, 'reference_externe' | 'creneau_debut'>,
  today: Date,
): { ref_label: string; ref_value: string } {
  const refExterne = (iv.reference_externe ?? '').trim();
  if (refExterne) {
    if (FOXO_REF_RE.test(refExterne)) {
      return { ref_label: 'Réf. dossier :', ref_value: refExterne };
    }
    return { ref_label: 'Réf. syndic :', ref_value: refExterne };
  }
  const date = iv.creneau_debut ? new Date(iv.creneau_debut) : today;
  return { ref_label: 'Date intervention :', ref_value: fmtDateShort(date) };
}
