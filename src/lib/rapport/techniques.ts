// Liste fermée canonique des 8 techniques d'inspection FoxO (libellés EXACTS
// du template Word). Source de vérité partagée entre :
//   - le moteur docx (build-docx.ts) et le mapping (report-data-mapping.ts)
//   - la dérivation depuis observations_terrain (buildTechniques)
//   - la persistance rapports.techniques (text[] de clés) + le snapshot
//     à la publication (publishRapport)
//   - l'édition admin (cases à cocher du drawer)
//
// On persiste des CLÉS stables (immunes aux retouches de libellé), pas les
// libellés ; le libellé d'affichage est résolu via cette constante.

export const RAPPORT_TECHNIQUES = [
  { key: 'capteur',    label: "Capteur d'humidité" },
  { key: 'thermique',  label: 'Thermographie infrarouge' },
  { key: 'camera',     label: 'Caméra endoscopique' },
  { key: 'traceur',    label: 'Liquide traceur' },
  { key: 'acoustique', label: 'Détection acoustique' },
  { key: 'pression',   label: 'Test pression / Compteur' },
  { key: 'gaz',        label: 'Gaz traceur' },
  { key: 'visuelle',   label: 'Inspection visuelle' },
] as const;

export type TechniqueKey = typeof RAPPORT_TECHNIQUES[number]['key'];

// 8 booléens (un par technique). Forme consommée par les moteurs docx/pdf.
export type ReportTechniques = Record<TechniqueKey, boolean>;

const ALL_KEYS = RAPPORT_TECHNIQUES.map((t) => t.key) as readonly TechniqueKey[];

function emptyTechniques(): ReportTechniques {
  return ALL_KEYS.reduce((acc, k) => {
    acc[k] = false;
    return acc;
  }, {} as ReportTechniques);
}

// Tableau de clés (rapports.techniques) → 8 booléens. Ignore les clés inconnues.
export function techniquesFromKeys(keys: readonly string[] | null | undefined): ReportTechniques {
  const set = new Set(keys ?? []);
  const out = emptyTechniques();
  for (const k of ALL_KEYS) out[k] = set.has(k);
  return out;
}

// 8 booléens → tableau des clés cochées (pour persistance rapports.techniques).
export function techniquesToKeys(t: ReportTechniques): TechniqueKey[] {
  return ALL_KEYS.filter((k) => t[k]);
}

// true si au moins une technique est cochée.
export function hasAnyTechnique(t: ReportTechniques): boolean {
  return ALL_KEYS.some((k) => t[k]);
}

const LABEL_TO_KEY = new Map<string, TechniqueKey>(
  RAPPORT_TECHNIQUES.map((t) => [t.label, t.key]),
);

// Convertit une liste de LIBELLÉS (sortie de l'agent rapport v2) en CLÉS
// canoniques (stockées dans rapports.techniques). Filtre tout libellé hors
// liste fermée (console.warn) ; dédupliqué, ordre des clés préservé.
export function techniquesLabelsToKeys(labels: readonly string[] | null | undefined): TechniqueKey[] {
  const keys = new Set<TechniqueKey>();
  for (const raw of labels ?? []) {
    const k = LABEL_TO_KEY.get(String(raw).trim());
    if (k) keys.add(k);
    else if (raw) console.warn(`[techniques] libellé hors liste fermée ignoré: "${raw}"`);
  }
  return ALL_KEYS.filter((k) => keys.has(k));
}
