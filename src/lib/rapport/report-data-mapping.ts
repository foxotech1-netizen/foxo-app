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
import type { ReportTechniques } from '@/lib/rapport/build-docx';

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
// Cascade de priorité (descendante) :
//   1. iv.description si non vide ET < 300 chars (le syndic la rédige
//      souvent comme un mini-objet — ex. "Écoulements sporadiques au
//      plafond de la salle de bain de l'appartement E44 – Recherche
//      d'origine – Investigation appartement E54")
//   2. Sinon, 1ʳᵉ ligne de rapport.degats si < 200 chars (résumé court
//      écrit par le tech)
//   3. Fallback : "Recherche de fuite – {acp.nom | adresse courte}"
export function buildObjet(
  rapport: Rapport | null,
  acp: Pick<Acp, 'nom' | 'adresse' | 'code_postal' | 'ville'> | null,
  iv: Pick<Intervention, 'adresse' | 'description'>,
): string {
  const description = (iv.description ?? '').trim();
  if (description.length > 0 && description.length < 300) {
    return description;
  }
  const degats = (rapport?.degats ?? '').trim();
  if (degats) {
    const firstLine = degats.split(/\r?\n/)[0]?.trim() ?? '';
    if (firstLine.length > 0 && firstLine.length < 200) {
      return firstLine;
    }
  }
  const adresseCourte =
    acp?.nom?.trim()
    || acp?.adresse?.trim()
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
  iv: Pick<Intervention, 'nom_facturation' | 'email_facturation' | 'bce_facturation' | 'adresse'>,
  acp: Pick<Acp, 'nom' | 'bce'> | null,
  syndic: Pick<Organisation, 'nom' | 'adresse' | 'contact' | 'email'> | null,
): FacturationLines {
  // Ligne 1 — ACP nom + BCE (override iv.nom_facturation prioritaire).
  const acpNomBce = acp?.bce && acp?.nom
    ? `${acp.nom}${SEP_DASH}BCE ${acp.bce}`
    : (acp?.nom ?? '');
  const facturation_ligne1 = (iv.nom_facturation?.trim()) || acpNomBce;

  // Traçabilité (audit Rapport v2) : on ne fabrique JAMAIS une donnée manquante,
  // on omet la ligne et on logue pour que la relecture admin sache quoi compléter.
  if (acp && !acp.bce) console.warn('[rapport] facturation : BCE ACP manquante (ligne BCE omise).');
  if (!acp?.nom && !iv.nom_facturation?.trim()) console.warn('[rapport] facturation : nom client/ACP manquant.');

  // Cas standard — un syndic est rattaché : "c/o {nom} – {contact}" L2,
  // puis rue L3 et CP+ville L4 parsés depuis syndic.adresse.
  if (syndic?.nom) {
    const facturation_ligne2 =
      `c/o ${syndic.nom}${syndic.contact?.trim() ? SEP_DASH + syndic.contact.trim() : ''}`;
    if (!syndic.contact?.trim()) console.warn('[rapport] facturation : contact syndic manquant (omis).');
    const { rue, cpVille } = splitSyndicAdresse(syndic.adresse ?? null);
    if (!rue && !cpVille) console.warn('[rapport] facturation : adresse syndic absente/illisible (lignes rue + CP/ville omises).');
    return {
      facturation_ligne1,
      facturation_ligne2,
      facturation_ligne3: rue,
      facturation_ligne4: cpVille,
    };
  }

  console.warn('[rapport] facturation : aucun syndic rattaché — repli sur données intervention.');

  // Fallback — pas de syndic : on remplit avec ce qu'on a sur
  // l'intervention (override email_facturation/bce_facturation +
  // adresse intervention) pour ne pas laisser le bloc vide.
  const ivAdresseSplit = splitSyndicAdresse(iv.adresse ?? null);
  const facturation_ligne2 =
    iv.email_facturation?.trim()
    || syndic?.email?.trim()
    || '';
  const facturation_ligne3 =
    ivAdresseSplit.rue
    || (iv.bce_facturation?.trim() ? `BCE ${iv.bce_facturation.trim()}` : '');
  const facturation_ligne4 =
    ivAdresseSplit.cpVille
    || '';

  // Si rien de tout ça n'est rempli (cas extrême : aucun syndic, aucune
  // donnée override, aucune adresse intervention), on signale au moins
  // que c'est un client particulier — évite un bloc complètement vide
  // dans le rapport final, qui passerait à l'œil pendant la relecture.
  const allEmpty = !facturation_ligne1
    && !facturation_ligne2
    && !facturation_ligne3
    && !facturation_ligne4;
  return allEmpty
    ? {
        facturation_ligne1: 'Particulier',
        facturation_ligne2: '',
        facturation_ligne3: '',
        facturation_ligne4: '',
      }
    : {
        facturation_ligne1,
        facturation_ligne2,
        facturation_ligne3,
        facturation_ligne4,
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

// Une ligne par occupant (audit Rapport v2) : "Appartement X : Nom (statut)".
// Le builder docx scinde sur '\n' pour rendre un paragraphe par occupant.
// (Le template d'origine joignait par « – » sur une seule ligne ; on préfère
// une ligne/occupant pour la lisibilité quand le dossier en compte plusieurs.)
export function buildAdresseInterventionLine2(
  occupants: ReadonlyArray<Pick<Occupant, 'appartement' | 'prenom' | 'nom' | 'type_occupant'>>,
): string {
  return occupants
    .map((o) => formatOccupant(o))
    .filter((s): s is string => s !== null)
    .join('\n');
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

// ─── Techniques d'inspection (8 booleans) ─────────────────────────────
//
// Mappe les test_type d'observations_terrain → 8 cases à cocher du
// template. Accepte les anciennes valeurs ('Mise en pression',
// 'Humidimètre') ET les nouvelles (post-vocab alignment commit 7514a08)
// pour rétro-compat avec les rows historiques.
//
// Test types attendus en DB :
//   - 'Capteur d'humidité' / 'Humidimètre'   → capteur
//   - 'Thermographie'                         → thermique
//   - 'Caméra endoscopique'                   → camera
//   - 'Test colorant'                         → traceur
//   - 'Détection acoustique'                  → acoustique
//   - 'Test de pression' / 'Mise en pression' → pression
//   - 'Gaz traceur'                           → gaz
//   - 'Inspection visuelle'                   → visuelle
export function buildTechniques(observations: ReadonlyArray<{ test_type: string }>): ReportTechniques {
  const types = new Set(observations.map((o) => o.test_type));
  return {
    capteur:    types.has("Capteur d'humidité") || types.has('Humidimètre'),
    thermique:  types.has('Thermographie'),
    camera:     types.has('Caméra endoscopique'),
    traceur:    types.has('Test colorant'),
    acoustique: types.has('Détection acoustique'),
    pression:   types.has('Test de pression') || types.has('Mise en pression'),
    gaz:        types.has('Gaz traceur'),
    visuelle:   types.has('Inspection visuelle'),
  };
}
