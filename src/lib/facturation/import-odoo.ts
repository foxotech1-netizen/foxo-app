// Import Odoo — reprise de l'historique 2026 (ventes + achats) par CSV.
//
// Fonctions PURES et testables : parsing CSV maison (papaparse absent du
// projet — aucune dépendance ajoutée), normalisation tolérante des en-têtes
// FR/EN d'Odoo, mapping vers les payloads factures / factures_achat.
// L'écriture en base est faite par la Server Action (import/actions.ts).
//
// Règles de périmètre (spec mini-chantier) :
//   - seules les pièces Odoo « posted / comptabilisé » sont importées ;
//   - TTC < 0 (avoirs) → ignorées avec raison — les avoirs ne sont pas repris ;
//   - date d'émission < 2026-01-01 → « hors période » ;
//   - relances_pause = true sur TOUT l'import ventes (l'historique ne doit
//     jamais déclencher de relance FoxO) ;
//   - date_paiement reste NULL même pour les pièces payées : l'information
//     n'existe pas dans l'export Odoo standard (documenté à l'écran).

// ─── Parsing CSV maison ─────────────────────────────────────────────────────

/**
 * Parse un CSV Odoo : BOM UTF-8 toléré, séparateur ';' ou ',' auto-détecté
 * (comptage hors guillemets sur la ligne d'en-têtes), champs entre guillemets
 * avec guillemets doublés ("") et retours à la ligne internes acceptés.
 * Renvoie des objets clé → valeur avec en-têtes NORMALISÉS (minuscules,
 * sans accents, espaces simples).
 */
export function parseOdooCsv(text: string): Record<string, string>[] {
  // BOM UTF-8
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (!clean.trim()) return [];

  // Détection du séparateur sur la première ligne, hors guillemets.
  const firstLineEnd = clean.indexOf('\n');
  const firstLine = firstLineEnd === -1 ? clean : clean.slice(0, firstLineEnd);
  let inQ = false;
  let commas = 0;
  let semis = 0;
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch === ',') commas += 1;
    else if (!inQ && ch === ';') semis += 1;
  }
  const sep = semis >= commas ? ';' : ',';

  // Machine à états : découpe en lignes de cellules.
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { cell += '"'; i += 1; } // guillemet doublé
        else inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === sep) {
      row.push(cell); cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);

  if (rows.length < 2) return [];

  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map((cells) => {
    const out: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (h) out[h] = (cells[idx] ?? '').trim();
    });
    return out;
  });
}

/** Normalise un en-tête : minuscules, sans accents, espaces simples. */
export function normalizeHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Résolution tolérante des colonnes Odoo (FR/EN) ────────────────────────

export interface LigneOdoo {
  numero: string;
  partenaire: string;
  tva_partenaire: string;
  date_emission: string;
  date_echeance: string;
  reference: string;
  ht: string;
  ttc: string;
  statut_paiement: string;
  statut: string;
}

/** Valeurs de statut de DOCUMENT (par opposition à un statut de paiement).
 *  Sert au fallback de récupération quand le statut de validation a été rangé
 *  par Odoo dans la colonne « Statut en cours de paiement ». normalise() gère
 *  accents/casse. */
const STATUT_DOC_TOKENS = [
  'comptabilise', 'comptabilisee', 'envoye', 'envoyee', 'sent',
  'brouillon', 'draft', 'posted',
];
function estStatutDocument(v: string): boolean {
  const n = normalise(v);
  if (!n) return false;
  return STATUT_DOC_TOKENS.some((t) => n === t || n.includes(t));
}

/**
 * Projette une ligne clé/valeur (en-têtes normalisés) vers les champs
 * canoniques. Le mapping est tolérant aux variantes FR/EN d'Odoo.
 *
 * Colonne de statut de VALIDATION — trois passes (cf. exports réels) :
 *   1. en-tête EXACT 'statut'/'status'/'state'/'etat' ;
 *   2. à défaut, en-tête GÉNÉRIQUE contenant 'statut'/'status'/'etat' mais NI
 *      'peppol' (colonne « Statut PEPPOL ») NI 'paiement'/'payment' (colonne
 *      « Statut de paiement ») ;
 *   3. FALLBACK : certains exports rangent le statut de document
 *      ('Comptabilisé'/'Envoyé') dans la colonne « Statut en cours de
 *      paiement ». Si aucune colonne de validation n'a été trouvée par 1 & 2
 *      ET que la colonne de paiement porte une valeur de type document, on la
 *      consomme comme statut de validation ; le paiement devient alors inconnu
 *      (→ statut FoxO 'envoyee' par défaut côté mapping).
 */
export function resoudreColonnes(row: Record<string, string>): LigneOdoo {
  const keys = Object.keys(row);
  const exact = (...names: string[]) =>
    keys.find((k) => names.includes(k)) ?? null;
  const contient = (...frags: string[]) =>
    keys.find((k) => frags.some((f) => k.includes(f))) ?? null;
  const val = (k: string | null) => (k ? row[k] ?? '' : '');

  const colPaiement = contient('paiement', 'payment');

  // Passes 1 & 2 : colonne de validation par en-tête.
  let colStatut = exact('statut', 'status', 'state', 'etat');
  if (!colStatut) {
    colStatut = keys.find((k) =>
      (k.includes('statut') || k.includes('status') || k.includes('etat'))
      && !k.includes('peppol')
      && !k.includes('paiement') && !k.includes('payment'),
    ) ?? null;
  }

  let statut = val(colStatut);
  let statutPaiement = val(colPaiement);
  // Passe 3 : fallback de récupération sur la colonne de paiement.
  if (!colStatut && colPaiement && estStatutDocument(statutPaiement)) {
    statut = statutPaiement;
    statutPaiement = '';
  }

  return {
    numero: val(exact('numero', 'number')),
    partenaire: val(exact('partenaire', 'partner')),
    tva_partenaire: val(contient('tva', 'vat')),
    date_emission: val(contient('date de facturation', 'invoice date')),
    date_echeance: val(contient('echeance', 'due')),
    reference: val(exact('reference')),
    ht: val(contient('hors taxes', 'untaxed')),
    ttc: val(exact('total')),
    statut_paiement: statutPaiement,
    statut,
  };
}

// ─── Conversions ────────────────────────────────────────────────────────────

/** Montant Odoo → number. Accepte « 1 234,56 », « 1.234,56 », « 1,234.56 »,
 *  « 1234.56 » (espaces/nbsp et symboles monétaires retirés). */
export function parseMontant(raw: string): number | null {
  const s = raw.replace(/[\s  €]/g, '').trim();
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let normalized: string;
  if (lastComma !== -1 && lastDot !== -1) {
    // Le dernier des deux est le séparateur décimal, l'autre des milliers.
    normalized = lastComma > lastDot
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (lastComma !== -1) {
    normalized = s.replace(/\./g, '').replace(',', '.');
  } else {
    normalized = s;
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Date Odoo → ISO YYYY-MM-DD. Accepte JJ/MM/AAAA et ISO. */
export function parseDateOdoo(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const fr = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (fr) return `${fr[3]}-${fr[2]}-${fr[1]}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

const TAUX_BELGES = [0, 6, 12, 21];

/** Taux TVA dérivé de (ttc-ht)/ht, rapproché du taux belge le plus proche
 *  (tolérance 0.5 pt), sinon taux exact arrondi à 2 décimales. */
export function deriverTauxTva(ht: number, ttc: number): number {
  if (ht === 0) return 0;
  const brut = ((ttc - ht) / ht) * 100;
  for (const t of TAUX_BELGES) {
    if (Math.abs(brut - t) <= 0.5) return t;
  }
  return Math.round(brut * 100) / 100;
}

// ─── Mapping ventes / achats ────────────────────────────────────────────────

// Statuts définitifs importés (règle métier tranchée par le client) :
// « Comptabilisé » ET « Envoyé ». « Brouillon » / « draft » restent exclus.
const STATUTS_POSTES = new Set([
  'posted', 'comptabilise', 'comptabilisee', 'envoye', 'envoyee', 'sent',
]);
const PAIEMENT_PAYE = ['paye', 'payee', 'paid', 'in_payment', 'in payment'];

function normalise(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function estPaye(statutPaiement: string): boolean {
  const n = normalise(statutPaiement);
  if (!n) return false;
  // « Non payé » / « Not paid » / « Partiellement payé » contiennent le mot
  // « payé » : on les exclut AVANT le test d'inclusion.
  if (n.startsWith('non') || n.startsWith('not') || n.includes('partiel') || n.includes('partial')) {
    return false;
  }
  return PAIEMENT_PAYE.some((p) => n === p || n.includes(p));
}

export interface FactureLigneImport {
  description: string;
  quantite: number;
  prix_unitaire: number;
  tva_pct: number;
}

export interface VenteImport {
  numero: string;
  client_nom: string | null;
  client_bce: string | null;
  date_emission: string;
  date_echeance: string | null;
  reference: string | null;
  montant_ht: number;
  montant_tva: number;
  montant_ttc: number;
  tva_pct: number;
  lignes: FactureLigneImport[];
  statut: 'payee' | 'envoyee';
  odoo_move_id: string;
}

export interface AchatImport {
  numero_piece: string;
  fournisseur_nom: string;
  fournisseur_tva: string | null;
  date_facture: string;
  date_echeance: string | null;
  montant_ht: number;
  montant_tva: number;
  montant_ttc: number;
  taux_tva: number;
  statut: 'payee' | 'a_payer';
  odoo_move_id: string;
}

export type MapResult<T> =
  | { ok: true; piece: T }
  | { ok: false; numero: string; raison: string; regroupement?: boolean };

const DEBUT_PERIODE = '2026-01-01';

// Raison dédiée aux lignes de sous-total de regroupement Odoo (comptées à part,
// jamais mêlées aux rejets pour statut / période).
export const RAISON_REGROUPEMENT = 'ligne de regroupement Odoo (ignorée)';

// Sous-total de regroupement Odoo : « 2026 (80) », « T2 2026 (34) »,
// « S1 2026 (12) »… (préfixe optionnel type/trimestre, année, effectif).
const RE_REGROUPEMENT = /^\s*([A-Za-z]?\d{1,4}\s+)?\d{4}\s*\(\d+\)\s*$/;

/**
 * Détecte une ligne de regroupement (sous-total) : soit son « numéro » matche
 * le motif de libellé de regroupement Odoo, soit c'est une ligne à numéro seul
 * (partenaire vide, date vide, total non exploitable comme pièce).
 */
export function estLigneRegroupement(l: LigneOdoo): boolean {
  const numero = l.numero.trim();
  if (!numero) return false;
  if (RE_REGROUPEMENT.test(numero)) return true;
  const partenaireVide = !l.partenaire.trim();
  const dateVide = !l.date_emission.trim();
  const totalInexploitable = parseMontant(l.ttc) == null;
  return partenaireVide && dateVide && totalInexploitable;
}

// Filtres communs ventes/achats. null = ligne valide.
function filtreCommun(l: LigneOdoo): { numero: string; raison: string } | null {
  const numero = l.numero.trim();
  if (!numero) return { numero: '(sans numéro)', raison: 'numéro Odoo manquant' };
  const statut = normalise(l.statut);
  if (!STATUTS_POSTES.has(statut)) {
    return { numero, raison: `statut « ${l.statut || '—'} » non comptabilisé` };
  }
  const date = parseDateOdoo(l.date_emission);
  if (!date) return { numero, raison: 'date de facturation illisible' };
  if (date < DEBUT_PERIODE) return { numero, raison: 'hors période (< 2026-01-01)' };
  const ht = parseMontant(l.ht);
  const ttc = parseMontant(l.ttc);
  if (ht == null || ttc == null) return { numero, raison: 'montants illisibles' };
  if (ttc < 0) return { numero, raison: 'avoir — non importé' };
  return null;
}

export function mapVente(row: Record<string, string>): MapResult<VenteImport> {
  const l = resoudreColonnes(row);
  if (estLigneRegroupement(l)) {
    return { ok: false, numero: l.numero.trim() || '(sous-total)', raison: RAISON_REGROUPEMENT, regroupement: true };
  }
  const rejet = filtreCommun(l);
  if (rejet) return { ok: false, ...rejet };

  const numero = l.numero.trim();
  const date = parseDateOdoo(l.date_emission)!;
  const ht = parseMontant(l.ht)!;
  const ttc = parseMontant(l.ttc)!;
  const taux = deriverTauxTva(ht, ttc);
  const reference = l.reference.trim() || null;

  return {
    ok: true,
    piece: {
      numero,
      client_nom: l.partenaire.trim() || null,
      client_bce: l.tva_partenaire.trim() || null,
      date_emission: date,
      date_echeance: parseDateOdoo(l.date_echeance),
      reference,
      montant_ht: ht,
      montant_tva: Math.round((ttc - ht) * 100) / 100,
      montant_ttc: ttc,
      tva_pct: taux,
      lignes: [
        {
          description: `Reprise Odoo — ${numero}${reference ? ` (${reference})` : ''}`,
          quantite: 1,
          prix_unitaire: ht,
          tva_pct: taux,
        },
      ],
      // date_paiement volontairement absente : l'export Odoo ne la porte pas.
      statut: estPaye(l.statut_paiement) ? 'payee' : 'envoyee',
      odoo_move_id: numero,
    },
  };
}

export function mapAchat(row: Record<string, string>): MapResult<AchatImport> {
  const l = resoudreColonnes(row);
  if (estLigneRegroupement(l)) {
    return { ok: false, numero: l.numero.trim() || '(sous-total)', raison: RAISON_REGROUPEMENT, regroupement: true };
  }
  const rejet = filtreCommun(l);
  if (rejet) return { ok: false, ...rejet };

  const numero = l.numero.trim();
  const ht = parseMontant(l.ht)!;
  const ttc = parseMontant(l.ttc)!;

  return {
    ok: true,
    piece: {
      // Le n° de pièce du FOURNISSEUR est dans « Référence » côté Odoo ;
      // à défaut on retombe sur le numéro Odoo interne.
      numero_piece: l.reference.trim() || numero,
      fournisseur_nom: l.partenaire.trim() || '(fournisseur inconnu)',
      fournisseur_tva: l.tva_partenaire.trim() || null,
      date_facture: parseDateOdoo(l.date_emission)!,
      date_echeance: parseDateOdoo(l.date_echeance),
      montant_ht: ht,
      montant_tva: Math.round((ttc - ht) * 100) / 100,
      montant_ttc: ttc,
      taux_tva: deriverTauxTva(ht, ttc),
      statut: estPaye(l.statut_paiement) ? 'payee' : 'a_payer',
      odoo_move_id: numero,
    },
  };
}
