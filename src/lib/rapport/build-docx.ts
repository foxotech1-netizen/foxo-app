// Génération du rapport au format Microsoft Word (.docx) — port fidèle de
// FOXO_BASE.js (template propriétaire FoxO).
//
// Photos : récupérées depuis photos_interventions (lien section + ordre,
// cf. migration 2026-05-28_photos_section.sql) ; bytes téléchargés via
// l'API Drive avec drive_file_id et le token OAuth FoxO. Les légendes
// (label) apparaissent sous chaque image en italique muted.
//
// Conventions FoxO : Calibri partout, palette navy/accent, prose
// uniquement (pas de listes), formulations prudentes pour les causes.

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  Header,
  Footer,
  Table,
  TableRow,
  TableCell,
  AlignmentType,
  BorderStyle,
  HeightRule,
  VerticalAlign,
  WidthType,
  ShadingType,
  PageBorderDisplay,
  PageBorderOffsetFrom,
  PageBorderZOrder,
} from 'docx';
import { getRapportLogoBytes, RAPPORT_LOGO } from '@/lib/rapport/logo';
import { fetchRapportPhotos, type RapportPhotoData } from '@/lib/rapport/photos';

// ─── Constantes du template (FOXO_BASE.js) ────────────────────────────

const PAGE_W = 11906;
const PAGE_H = 16838;
const MARGIN = 720;
const TW = 10466;

const DARK_BLUE   = '1B3A5C';
const MID_BLUE    = '2E75B6';
const ACCENT_LINE = '4A9FD4';
const LIGHT_BLUE  = 'EAF4FB';
const BODY_TEXT   = '1A1A1A';
const MUTED       = '6B6B6B';
const DIVIDER     = 'C0D4E8';

const FONT = 'Calibri';

// ─── Styling des cellules du tableau d'identification (FOXO_BASE.js) ──
// Bordures fines bleu pâle sur les 4 côtés, marges intérieures généreuses,
// alignement vertical centré. Spreadable via `...CELL_SHARED` dans toutes
// les TableCell du tableau d'identification pour cohérence visuelle.
const thinBorder = { style: BorderStyle.SINGLE, size: 4, color: DIVIDER };
const thinBorders = {
  top: thinBorder,
  bottom: thinBorder,
  left: thinBorder,
  right: thinBorder,
};
const CELL_SHARED = {
  borders: thinBorders,
  margins: { top: 110, bottom: 110, left: 140, right: 100 },
  verticalAlign: VerticalAlign.CENTER,
};

// Photos — grille 2 colonnes (max 2 par ligne, règle métier validée Foxo).
// Largeur de cellule = (largeur utile − gouttière) / 2. L'image occupe la
// largeur de la cellule (moins une marge interne), sa hauteur découle du
// ratio intrinsèque (préservé). Plafond de hauteur pour qu'un cliché portrait
// ne dévore pas la page. 1px ≈ 15 DXA.
const PHOTO_GUTTER_DXA = 240;
const PHOTO_CELL_DXA = Math.floor((TW - PHOTO_GUTTER_DXA) / 2); // 5113
const PHOTO_CELL_W_PX = Math.floor(PHOTO_CELL_DXA / 15) - 16;   // ≈ 324 (marge interne)
const PHOTO_MAX_H_PX = 460;

// ─── ReportData — input contrat du builder ────────────────────────────

// ReportTechniques est désormais défini dans le module canonique partagé
// (src/lib/rapport/techniques.ts). Importé ici et ré-exporté pour ne pas
// casser les imports existants (report-data-mapping, etc.).
import type { ReportTechniques } from '@/lib/rapport/techniques';
export type { ReportTechniques };

export interface ReportData {
  numero: string;
  ref_label: string;
  ref_value: string;
  objet: string;
  facturation_ligne1: string;
  facturation_ligne2: string;
  facturation_ligne3: string;
  facturation_ligne4: string;
  adresse_ligne1: string;
  adresse_ligne2: string;
  adresse_ligne3: string;
  techniques: ReportTechniques;
  degats: string;
  inspection: string;
  conclusion: string;
  recommandation: string;
  fait_a_date: string;
}

// ─── Helpers atomiques (port FOXO_BASE) ───────────────────────────────

interface TextOpts {
  size?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  allCaps?: boolean;
}

function t(text: string, opts: TextOpts = {}): TextRun {
  return new TextRun({
    text,
    font: FONT,
    size: opts.size ?? 20,
    bold: opts.bold ?? false,
    italics: opts.italic ?? false,
    color: opts.color ?? BODY_TEXT,
    allCaps: opts.allCaps ?? false,
  });
}

function gap(before = 160, after = 0): Paragraph {
  return new Paragraph({ spacing: { before, after }, children: [] });
}

function sectionTitle(label: string): Paragraph {
  return new Paragraph({
    spacing: { before: 340, after: 200 },
    children: [t(label, { bold: true, allCaps: true, size: 32, color: DARK_BLUE })],
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 10, color: ACCENT_LINE, space: 6 },
    },
  });
}

function bodyText(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 100, after: 100, line: 360 },
    children: [t(text, { size: 21 })],
  });
}

function bodyTextMuted(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 100, after: 100, line: 360 },
    children: [t(text, { size: 21, italic: true, color: MUTED })],
  });
}

// Checkbox + libellé pour la section Techniques. Cochée = ☑ bold dark_blue,
// non cochée = ☐ mid_blue. Texte du libellé en NORMAL (conforme template :
// pas d'italique) — cochée en gras dark_blue, non cochée en body normal.
function checkItem(text: string, checked: boolean): Paragraph {
  return new Paragraph({
    spacing: { before: 55, after: 55 },
    indent: { left: 80 },
    children: [
      t(checked ? '☑  ' : '☐  ', {
        size: 18,
        color: checked ? DARK_BLUE : MID_BLUE,
        bold: checked,
      }),
      t(text, {
        size: 18,
        italic: false,
        bold: checked,
        color: checked ? DARK_BLUE : BODY_TEXT,
      }),
    ],
  });
}

// Split texte sur '||PARA||' pour générer un Paragraph par bloc. Si vide,
// affiche '—' italic muted (placeholder pour brouillon).
function textToParas(text: string): Paragraph[] {
  if (!text || !text.trim()) return [bodyTextMuted('—')];
  return text.split(/\|\|PARA\|\|/g).map((para) => bodyText(para.trim()));
}

// ─── Helpers cellules tableau identification ──────────────────────────

function labelCell(width: number, label: string, columnSpan?: number): TableCell {
  return new TableCell({
    ...CELL_SHARED,
    width: { size: width, type: WidthType.DXA },
    columnSpan,
    shading: { type: ShadingType.CLEAR, fill: LIGHT_BLUE, color: 'auto' },
    children: [new Paragraph({
      children: [t(label, { bold: true, color: DARK_BLUE, size: 19 })],
    })],
  });
}

function valueCell(width: number, value: string, columnSpan?: number): TableCell {
  return new TableCell({
    ...CELL_SHARED,
    width: { size: width, type: WidthType.DXA },
    columnSpan,
    children: [new Paragraph({
      children: [t(value || '—', { size: 20 })],
    })],
  });
}

// Construit le tableau d'identification 5 lignes selon FOXO_BASE.js.
function buildIdentificationTable(data: ReportData): Table {
  const C1 = 1900;
  const C2 = 3333;
  const C3 = 1900;
  const C4 = 3333;

  // L3 (gauche) : objet (1 paragraphe simple)
  const objetCell = new TableCell({
    ...CELL_SHARED,
    width: { size: C1 + C2, type: WidthType.DXA },
    columnSpan: 2,
    children: [new Paragraph({
      children: [t(data.objet || '—', { size: 20 })],
    })],
  });

  // L3 (droite) : facturation 4 lignes (un Paragraph par ligne non vide)
  const facturationParas = [
    data.facturation_ligne1,
    data.facturation_ligne2,
    data.facturation_ligne3,
    data.facturation_ligne4,
  ]
    .filter((line) => line && line.trim())
    .map((line) => new Paragraph({
      children: [t(line, { size: 20 })],
    }));
  const facturationCell = new TableCell({
    ...CELL_SHARED,
    width: { size: C3 + C4, type: WidthType.DXA },
    columnSpan: 2,
    children: facturationParas.length > 0
      ? facturationParas
      : [new Paragraph({ children: [t('—', { size: 20 })] })],
  });

  // L4 : adresse intervention — ligne1 normal, ligne2 + ligne3 italic muted
  const adresseParas: Paragraph[] = [];
  if (data.adresse_ligne1) {
    adresseParas.push(new Paragraph({
      children: [t(data.adresse_ligne1, { size: 20 })],
    }));
  }
  if (data.adresse_ligne2) {
    // Une ligne (paragraphe) par occupant — la valeur est scindée sur '\n'
    // (cf. buildAdresseInterventionLine2).
    for (const occLine of data.adresse_ligne2.split('\n').map((s) => s.trim()).filter(Boolean)) {
      adresseParas.push(new Paragraph({
        children: [t(occLine, { size: 19, italic: true, color: MUTED })],
      }));
    }
  }
  if (data.adresse_ligne3) {
    adresseParas.push(new Paragraph({
      children: [t(data.adresse_ligne3, { size: 19, italic: true, color: MUTED })],
    }));
  }
  if (adresseParas.length === 0) {
    adresseParas.push(new Paragraph({ children: [t('—', { size: 20 })] }));
  }
  const adresseCell = new TableCell({
    ...CELL_SHARED,
    width: { size: C2 + C3 + C4, type: WidthType.DXA },
    columnSpan: 3,
    children: adresseParas,
  });

  // L5 : Techniques — col gauche 4 checkboxes (span 2), col droite 4 (C4)
  const techniquesLeft = new TableCell({
    ...CELL_SHARED,
    width: { size: C2 + C3, type: WidthType.DXA },
    columnSpan: 2,
    children: [
      checkItem("Capteur d'humidité",       data.techniques.capteur),
      checkItem('Thermographie infrarouge', data.techniques.thermique),
      checkItem('Caméra endoscopique',      data.techniques.camera),
      checkItem('Liquide traceur',          data.techniques.traceur),
    ],
  });
  const techniquesRight = new TableCell({
    ...CELL_SHARED,
    width: { size: C4, type: WidthType.DXA },
    children: [
      checkItem('Détection acoustique',     data.techniques.acoustique),
      checkItem('Test pression / Compteur', data.techniques.pression),
      checkItem('Gaz traceur',              data.techniques.gaz),
      checkItem('Inspection visuelle',      data.techniques.visuelle),
    ],
  });

  return new Table({
    width: { size: TW, type: WidthType.DXA },
    columnWidths: [C1, C2, C3, C4],
    rows: [
      // L1 : N° Intervention | numero | ref_label | ref_value
      new TableRow({
        children: [
          labelCell(C1, 'N° Intervention :'),
          valueCell(C2, data.numero),
          labelCell(C3, data.ref_label),
          valueCell(C4, data.ref_value),
        ],
      }),
      // L2 : "Objet intervention :" (span 2) | "Adresse Facturation :" (span 2)
      new TableRow({
        children: [
          labelCell(C1 + C2, 'Objet intervention :', 2),
          labelCell(C3 + C4, 'Adresse Facturation :', 2),
        ],
      }),
      // L3 : objet contenu (span 2) | facturation 4 lignes (span 2) — h ≥ 1000
      new TableRow({
        height: { value: 1000, rule: HeightRule.ATLEAST },
        children: [objetCell, facturationCell],
      }),
      // L4 : "Adresse d'intervention :" | adresse 3 lignes (span 3) — h ≥ 820
      new TableRow({
        height: { value: 820, rule: HeightRule.ATLEAST },
        children: [
          labelCell(C1, "Adresse d'intervention :"),
          adresseCell,
        ],
      }),
      // L5 : "Techniques d'inspection :" | col gauche (span 2) | col droite
      new TableRow({
        children: [
          labelCell(C1, "Techniques d'inspection :"),
          techniquesLeft,
          techniquesRight,
        ],
      }),
    ],
  });
}

// ─── Photos par section (grille 2 colonnes, jumelle du moteur PDF) ─────
// Source de données partagée : fetchRapportPhotos (src/lib/rapport/photos.ts)
// — DÉGÂTS + INSPECTION uniquement, triées par `ordre`, octets normalisés
// JPEG + dimensions intrinsèques. Le rendu ci-dessous calque celui du PDF :
// 2 photos par ligne, légende (label) sous chaque image, ratio préservé,
// paire image+légende insécable (cantSplit) pour ne jamais couper une
// légende du cliché qu'elle décrit en bas de page.

function fmtDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

type SectionKey = 'degats' | 'inspection' | 'conclusion' | 'recommandations';
type PhotoSectionKey = 'degats' | 'inspection';

// Dimensions d'affichage : largeur = largeur de cellule, hauteur dérivée du
// ratio intrinsèque (préservé). Plafond de hauteur pour un cliché portrait.
function photoDisplaySize(photo: RapportPhotoData): { width: number; height: number } {
  const ratio = photo.width > 0 && photo.height > 0 ? photo.width / photo.height : 4 / 3;
  let width = PHOTO_CELL_W_PX;
  let height = Math.round(width / ratio);
  if (height > PHOTO_MAX_H_PX) {
    height = PHOTO_MAX_H_PX;
    width = Math.round(height * ratio);
  }
  return { width, height };
}

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'auto' };
const CELL_NO_BORDERS = {
  top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER,
};

// Une cellule = une photo (image centrée + légende sous l'image), ou une
// cellule vide pour compléter une ligne impaire.
function photoCell(photo: RapportPhotoData | null): TableCell {
  if (!photo) {
    return new TableCell({
      width: { size: PHOTO_CELL_DXA, type: WidthType.DXA },
      borders: CELL_NO_BORDERS,
      children: [new Paragraph({ children: [] })],
    });
  }
  const { width, height } = photoDisplaySize(photo);
  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: photo.label ? 40 : 160 },
      children: [
        new ImageRun({
          data: photo.bytes,
          transformation: { width, height },
          type: 'jpg',
        }),
      ],
    }),
  ];
  if (photo.label) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 160 },
        children: [
          new TextRun({
            text: photo.label,
            size: 18,
            color: MUTED,
            italics: true,
            font: FONT,
          }),
        ],
      }),
    );
  }
  return new TableCell({
    width: { size: PHOTO_CELL_DXA, type: WidthType.DXA },
    borders: CELL_NO_BORDERS,
    verticalAlign: VerticalAlign.TOP,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children,
  });
}

function photosTable(photos: RapportPhotoData[]): Table | null {
  if (photos.length === 0) return null;

  const rows: TableRow[] = [];
  for (let i = 0; i < photos.length; i += 2) {
    rows.push(
      new TableRow({
        cantSplit: true, // paire(s) image+légende insécable(s) → pas de coupure de page
        children: [photoCell(photos[i]), photoCell(photos[i + 1] ?? null)],
      }),
    );
  }

  return new Table({
    width: { size: PHOTO_CELL_DXA * 2, type: WidthType.DXA },
    columnWidths: [PHOTO_CELL_DXA, PHOTO_CELL_DXA],
    borders: {
      top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER,
      insideHorizontal: NO_BORDER, insideVertical: NO_BORDER,
    },
    rows,
  });
}

// ─── Builder principal ────────────────────────────────────────────────

export async function buildRapportDocx(args: {
  interventionId: string;
  data: ReportData;
  date: Date;
}): Promise<Uint8Array> {
  const { data } = args;

  // Logo header — extrait du template Word (asset partagé avec le moteur PDF).
  // Best-effort : fallback texte "FoxO" si manquant. Dimensions reprises de
  // l'extent EMU du template (≈ 205 × 108 px), aligné à gauche comme dans
  // word/header1.xml.
  const logoBytes: Buffer | null = await getRapportLogoBytes();
  const logoWidth = RAPPORT_LOGO.widthPx;   // 205
  const logoHeight = RAPPORT_LOGO.heightPx; // 108
  // fmtDate accessible aux callers ; ici utilisé uniquement si data.fait_a_date vide
  void fmtDate;

  // Photos par section (source partagée avec le moteur PDF) — DÉGÂTS +
  // INSPECTION uniquement, normalisées JPEG + dimensions intrinsèques.
  const photosBySection = await fetchRapportPhotos(args.interventionId);

  // ─── Header ─────────────────────────────────────────────────────────
  const header = new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        children: logoBytes
          ? [
              new ImageRun({
                data: logoBytes,
                transformation: { width: logoWidth, height: logoHeight },
                type: 'jpg',
              }),
            ]
          : [t('FoxO', { bold: true, size: 36, color: DARK_BLUE })],
      }),
      new Paragraph({
        border: {
          bottom: { style: BorderStyle.SINGLE, color: DARK_BLUE, size: 12, space: 1 },
        },
        children: [],
      }),
    ],
  });

  // ─── Footer (3 lignes obligatoires FoxO) ────────────────────────────
  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          t(
            'Fox Group srl · Stationstraat 55, 3070 Kortenberg · info@foxo.be · +32 488 700 007',
            { size: 16, color: MUTED },
          ),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          t(
            'TVA : BE1030.109.019 · BEOBANK : BE62 9502 6652 9861',
            { size: 16, color: MUTED },
          ),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          t(
            '© 2026 Fox Group srl – Tous droits réservés – Rapport technique – Modèle propriétaire – Reproduction interdite',
            { size: 14, color: MUTED, italic: true },
          ),
        ],
      }),
    ],
  });

  // ─── Body ───────────────────────────────────────────────────────────
  // Titres en MAJUSCULES conformes au template (DÉGÂTS, INSPECTION, CONCLUSION,
  // RECOMMANDATION). On passe les libellés déjà en capitales (en plus de
  // allCaps dans sectionTitle) pour garantir le rendu quel que soit le client.
  const sectionsConfig: { key: SectionKey; title: string; text: string }[] = [
    { key: 'degats',          title: 'DÉGÂTS',         text: data.degats },
    { key: 'inspection',      title: 'INSPECTION',     text: data.inspection },
    { key: 'conclusion',      title: 'CONCLUSION',     text: data.conclusion },
    { key: 'recommandations', title: 'RECOMMANDATION', text: data.recommandation },
  ];

  const bodyChildren: (Paragraph | Table)[] = [
    // Titre principal
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 400 },
      children: [
        t("RAPPORT D'INTERVENTION", {
          bold: true, allCaps: true, size: 48, color: DARK_BLUE,
        }),
      ],
    }),

    // Tableau identification 5 lignes
    buildIdentificationTable(data),

    gap(200, 200),
  ];

  // 4 sections : titre + corps (split sur ||PARA||). Les photos ne sont
  // rattachées qu'en fin de DÉGÂTS et d'INSPECTION (règle métier Foxo).
  for (const s of sectionsConfig) {
    bodyChildren.push(sectionTitle(s.title));
    bodyChildren.push(...textToParas(s.text));
    if (s.key === 'degats' || s.key === 'inspection') {
      const tbl = photosTable(photosBySection[s.key as PhotoSectionKey]);
      if (tbl) bodyChildren.push(tbl);
    }
  }

  // Clôture (alignée droite)
  bodyChildren.push(
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: 600 },
      children: [
        // Conforme template : texte normal (pas d'italique), date en gras.
        t('Fait à Bruxelles le,  ', { size: 22, italic: false, color: MUTED }),
        t(data.fait_a_date, { size: 22, italic: false, bold: true, color: DARK_BLUE }),
      ],
    }),
  );

  // ─── Document ───────────────────────────────────────────────────────
  const doc = new Document({
    creator: 'FoxO',
    title: `Rapport ${data.numero}`,
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 21, color: BODY_TEXT },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_W, height: PAGE_H },
            margin: {
              top: MARGIN, right: MARGIN, bottom: 1300, left: MARGIN,
              header: 360, footer: 360,
            },
            borders: {
              pageBorderTop:    { style: BorderStyle.SINGLE, size: 18, color: DARK_BLUE, space: 24 },
              pageBorderRight:  { style: BorderStyle.SINGLE, size: 18, color: DARK_BLUE, space: 24 },
              pageBorderBottom: { style: BorderStyle.SINGLE, size: 18, color: DARK_BLUE, space: 24 },
              pageBorderLeft:   { style: BorderStyle.SINGLE, size: 18, color: DARK_BLUE, space: 24 },
              // Conformité FOXO_BASE.js : sans ces 3 propriétés, certains
              // clients Word (notamment Word for Mac et LibreOffice) tronquent
              // la bordure ou la rendent derrière l'en-tête. ALL_PAGES + PAGE
              // + FRONT garantissent un encadrement uniforme et au-dessus
              // du contenu de l'en-tête/pied de page. La lib docx (8.x) lit
              // ces 3 attrs UNIQUEMENT depuis ce sous-objet `pageBorders`
              // (cf. PageBorders dans dist/index.cjs:15935) — les mettre en
              // siblings de pageBorderTop/etc. est ignoré silencieusement
              // côté XML final.
              pageBorders: {
                display:    PageBorderDisplay.ALL_PAGES,
                offsetFrom: PageBorderOffsetFrom.PAGE,
                zOrder:     PageBorderZOrder.FRONT,
              },
            },
          },
        },
        headers: { default: header },
        footers: { default: footer },
        children: bodyChildren,
      },
    ],
  });

  const buf = await Packer.toBuffer(doc);
  return new Uint8Array(buf);
}
