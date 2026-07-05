// Import « encodage à froid » — reprise en masse d'interventions historiques
// depuis un fichier Excel (.xlsx), via la MÊME logique métier que le bouton
// « Créer une intervention » (createInterventionCold).
//
// Ce module ne contient QUE des fonctions pures et la config partagée entre
// la page admin (/admin/import — parsing du classeur côté client) et la
// route API (/api/admin/import/encodage-froid — validation + création).
// Aucun accès DB ici.
//
// Règle du chantier : les référentiels (ACP, syndics) existent déjà en base —
// l'import ne crée JAMAIS ni ACP ni organisation. Résolution seule ;
// introuvable = rejet de la ligne (la résolution vit dans la route).

import type { StatutIntervention } from '@/lib/types/database';

// ─── Ligne canonique du fichier ─────────────────────────────────────────────

export interface LigneImport {
  /** N° de ligne dans le fichier Excel (1-based ; la ligne 1 = en-têtes). */
  row: number;
  ref_foxo: string;
  date: string;
  heure: string;
  acp: string;
  bce: string;
  adresse: string;
  appartements: string;
  type: string;
  ref_syndic: string;
  syndic: string;
  contact_syndic: string;
  ref_sinistre: string;
  assureur: string;
  occupants: string;
  telephones: string;
  statut: string;
  rapport_drive: string;
}

/**
 * Mapping en-tête EXACT (ligne 1 du fichier) → champ canonique.
 * Source de vérité UNIQUE des libellés du fichier : aucun libellé métier
 * ne doit apparaître en dur ailleurs dans la logique d'import.
 */
export const COLONNES_IMPORT: ReadonlyArray<{
  header: string;
  field: Exclude<keyof LigneImport, 'row'>;
}> = [
  { header: 'N° intervention FoxO',       field: 'ref_foxo' },
  { header: 'Date',                        field: 'date' },
  { header: 'Heure',                       field: 'heure' },
  { header: 'ACP / Résidence',             field: 'acp' },
  { header: 'N° BCE',                      field: 'bce' },
  { header: "Adresse d'intervention",      field: 'adresse' },
  { header: 'Appartement(s)',              field: 'appartements' },
  { header: "Type d'intervention",         field: 'type' },
  { header: 'Réf. syndic',                 field: 'ref_syndic' },
  { header: 'Syndic',                      field: 'syndic' },
  { header: 'Contact syndic',              field: 'contact_syndic' },
  { header: 'Réf. assurance / sinistre',   field: 'ref_sinistre' },
  { header: 'Assureur / Courtier',         field: 'assureur' },
  { header: 'Occupant(s)',                 field: 'occupants' },
  { header: 'Téléphone(s)',                field: 'telephones' },
  { header: 'Statut',                      field: 'statut' },
  { header: 'Rapport (Drive)',             field: 'rapport_drive' },
];

// ─── Normalisation ──────────────────────────────────────────────────────────

/** Minuscules, sans accents, espaces simples. */
export function normalise(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalisation d'un nom d'ACP pour le matching : normalise() + retrait d'un
 * éventuel préfixe « ACP » / « Résidence » (appliqué aux DEUX côtés de la
 * comparaison — fichier ET base).
 */
export function normaliseNomAcp(s: string): string {
  let n = normalise(s);
  // Retrait itératif : « ACP Résidence du Parc » doit matcher « Résidence du
  // Parc » (chaque côté peut cumuler les préfixes).
  for (;;) {
    const next = n.replace(/^(acp|residence|res\.)\s+/, '');
    if (next === n) return n;
    n = next;
  }
}

// ─── Alias syndics ──────────────────────────────────────────────────────────

/**
 * Libellé du fichier → nom (ou fragment de nom) de la fiche `organisations`.
 * Comparaison sur formes normalisées (normalise()).
 */
export const ALIAS_SYNDICS: Record<string, string> = {
  'Regimo – Parte Group': 'Regimo',
  'IG Syndic (IGS)': 'IG Syndic',
  'Immobilière Le Col-Vert': 'Col-Vert',
};

/** Applique l'alias éventuel (comparaison normalisée), sinon renvoie l'entrée. */
export function resoudreAliasSyndic(nomFichier: string): string {
  const n = normalise(nomFichier);
  for (const [alias, cible] of Object.entries(ALIAS_SYNDICS)) {
    if (normalise(alias) === n) return cible;
  }
  return nomFichier;
}

// ─── Statuts du fichier → StatutIntervention ────────────────────────────────

/** Normalisation spécifique aux statuts : tirets (‑ – —) → ' - ' uniforme. */
function normaliseStatutLabel(s: string): string {
  return normalise(s.replace(/\s*[-–—]+\s*/g, ' - '));
}

// Clés = libellés du fichier NORMALISÉS (normaliseStatutLabel).
// Valeur null = statut connu mais non importable (rejet volontaire).
const STATUTS_FICHIER: Record<string, StatutIntervention | null> = {
  'realisee': 'realisee',
  'planifiee - confirmee': 'confirmee',
  'planifiee': 'confirmee',
  'planifiee - en attente confirmation': 'attente',
  'annulee': null,
};

// Statuts du fichier pour lesquels les occupants sont posés conf='confirme'
// (spec chantier : « Planifiée – confirmée » et « Réalisée » uniquement).
const STATUTS_OCCUPANTS_CONFIRMES = new Set(['realisee', 'planifiee - confirmee']);

export type MapStatutResult =
  | { ok: true; statut: StatutIntervention; occupantsConfirmes: boolean }
  | { ok: false; raison: string };

export function mapStatutFichier(raw: string): MapStatutResult {
  const key = normaliseStatutLabel(raw);
  if (!key) return { ok: false, raison: 'statut manquant' };
  if (!(key in STATUTS_FICHIER)) {
    return { ok: false, raison: `statut inconnu « ${raw.trim()} »` };
  }
  const statut = STATUTS_FICHIER[key];
  if (statut === null) return { ok: false, raison: 'statut non importable' };
  return { ok: true, statut, occupantsConfirmes: STATUTS_OCCUPANTS_CONFIRMES.has(key) };
}

// ─── Dates / heures / fuseau Europe-Brussels ────────────────────────────────

/** Date du fichier → ISO YYYY-MM-DD. Accepte AAAA-MM-JJ (attendu) et
 *  JJ/MM/AAAA (tolérance reformatage Excel). Valide le calendrier réel. */
export function parseDateImport(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  const fr = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (iso) { y = Number(iso[1]); m = Number(iso[2]); d = Number(iso[3]); }
  else if (fr) { y = Number(fr[3]); m = Number(fr[2]); d = Number(fr[1]); }
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Heure du fichier → 'HH:MM'. Vide → '09:00' (défaut chantier).
 *  Accepte H:MM et HH:MM:SS. Invalide → null. */
export function parseHeureImport(raw: string): string | null {
  const s = raw.trim();
  if (!s) return '09:00';
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

/** Offset Europe/Brussels ('+01:00' ou '+02:00') pour une date ISO donnée —
 *  DST résolu par Intl, pas de règle codée en dur. */
export function brusselsOffset(dateIso: string): string {
  const probe = new Date(`${dateIso}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Brussels',
    timeZoneName: 'shortOffset',
  }).formatToParts(probe);
  const tz = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+1';
  const m = tz.match(/([+-])(\d{1,2})/);
  const sign = m?.[1] ?? '+';
  const h = m ? Number(m[2]) : 1;
  return `${sign}${String(h).padStart(2, '0')}:00`;
}

/** Construit le timestamp ISO complet (Europe/Brussels) d'un créneau. */
export function creneauDebutIso(dateIso: string, heure: string): string {
  return `${dateIso}T${heure}:00${brusselsOffset(dateIso)}`;
}

// ─── Occupants : appariement positionnel ────────────────────────────────────

export interface OccupantImport {
  nom: string;
  telephone: string;
  appartement: string;
}

function splitListe(raw: string): string[] {
  return raw.split(';').map((s) => s.trim()).filter(Boolean);
}

/**
 * Apparie « Occupant(s) » / « Téléphone(s) » / « Appartement(s) » (split ';')
 * positionnellement :
 *   - téléphones excédentaires → concaténés sur le DERNIER occupant ;
 *   - appartements : index à index ; s'il n'y en a qu'UN pour plusieurs
 *     occupants, il s'applique à tous (best-effort) ;
 *   - téléphones sans aucun nom → un occupant anonyme par téléphone.
 */
export function appairerOccupants(
  occupantsRaw: string,
  telephonesRaw: string,
  appartementsRaw: string,
): OccupantImport[] {
  const noms = splitListe(occupantsRaw);
  const tels = splitListe(telephonesRaw);
  const apps = splitListe(appartementsRaw);

  if (noms.length === 0) {
    // Pas de nom : un occupant anonyme par téléphone (sinon rien).
    return tels.map((t, i) => ({
      nom: '',
      telephone: t,
      appartement: apps[i] ?? (apps.length === 1 ? apps[0] : ''),
    }));
  }

  return noms.map((nom, i) => {
    let telephone = tels[i] ?? '';
    // Dernier occupant : récupère tous les téléphones restants.
    if (i === noms.length - 1 && tels.length > noms.length) {
      telephone = tels.slice(i).join(' / ');
    }
    const appartement = apps[i] ?? (apps.length === 1 ? apps[0] : '');
    return { nom, telephone, appartement };
  });
}
