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
import fs from 'node:fs/promises';
import path from 'node:path';
import { imageSize } from 'image-size';
import { createAdminClient } from '@/lib/supabase/admin';
import { getValidAccessToken } from '@/lib/google-auth';

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

// Photos — hauteur fixe 302px, largeur calculée au ratio réel + clamp
// largeur ≤ moitié de TW (layout 2-cols).
const PHOTO_HEIGHT_PX = 302;
const PHOTO_FALLBACK_WIDTH_PX = 403; // 302 * 4/3
// Cap unique ~400px : photos rendues en colonne CENTRÉE (1 par row), pas
// en grille 2 cols. La largeur est plafonnée pour rester confortable à
// la lecture sans dévorer la page.
const PHOTO_MAX_WIDTH_PX = 400;

// ─── ReportData — input contrat du builder ────────────────────────────

export interface ReportTechniques {
  capteur: boolean;
  thermique: boolean;
  camera: boolean;
  traceur: boolean;
  acoustique: boolean;
  pression: boolean;
  gaz: boolean;
  visuelle: boolean;
}

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
// non cochée = ☐ mid_blue + texte body italic. Indent 80 pour aérer.
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
        italic: true,
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
    adresseParas.push(new Paragraph({
      children: [t(data.adresse_ligne2, { size: 19, italic: true, color: MUTED })],
    }));
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
          labelCell(C1, 'N° Intervention'),
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

// ─── Photos par section (inchangé) ────────────────────────────────────

function fmtDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function detectImageType(filename: string | null): 'jpg' | 'png' | 'gif' | 'bmp' {
  const ext = (filename ?? '').toLowerCase().match(/\.([a-z]+)$/)?.[1];
  if (ext === 'png') return 'png';
  if (ext === 'gif') return 'gif';
  if (ext === 'bmp') return 'bmp';
  return 'jpg';
}

async function fetchDrivePhotoBytes(
  fileId: string,
  token: string,
): Promise<Buffer | null> {
  try {
    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!r.ok) return null;
    const ab = await r.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

interface SectionPhoto {
  bytes: Buffer;
  type: 'jpg' | 'png' | 'gif' | 'bmp';
  filename: string;
  width: number;
  height: number;
  label: string | null;
}

function computePhotoDimensions(bytes: Buffer): { width: number; height: number } {
  let realW = 0;
  let realH = 0;
  try {
    const dim = imageSize(bytes);
    realW = dim.width ?? 0;
    realH = dim.height ?? 0;
  } catch {
    // image-size jette si format non détecté
  }
  if (!realW || !realH) {
    return { width: PHOTO_FALLBACK_WIDTH_PX, height: PHOTO_HEIGHT_PX };
  }
  const ratio = realW / realH;
  let height = PHOTO_HEIGHT_PX;
  let width = Math.round(height * ratio);
  if (width > PHOTO_MAX_WIDTH_PX) {
    width = PHOTO_MAX_WIDTH_PX;
    height = Math.round(width / ratio);
  }
  return { width, height };
}

type SectionKey = 'degats' | 'inspection' | 'conclusion' | 'recommandations';

async function fetchPhotosBySection(
  interventionId: string,
): Promise<Record<SectionKey, SectionPhoto[]>> {
  const empty: Record<SectionKey, SectionPhoto[]> = {
    degats: [], inspection: [], conclusion: [], recommandations: [],
  };

  const admin = createAdminClient();
  const { data } = await admin
    .from('photos_interventions')
    .select('drive_file_id, drive_url, filename, section, ordre, label')
    .eq('intervention_id', interventionId)
    .not('section', 'is', null)
    .order('section', { ascending: true })
    .order('ordre', { ascending: true });

  const rows = (data ?? []) as Array<{
    drive_file_id: string;
    drive_url: string;
    filename: string | null;
    section: SectionKey;
    ordre: number;
    label: string | null;
  }>;
  if (rows.length === 0) return empty;

  const auth = await getValidAccessToken();
  if (!auth) return empty;

  for (const p of rows) {
    const bytes = await fetchDrivePhotoBytes(p.drive_file_id, auth.access_token);
    if (!bytes) continue;
    const { width, height } = computePhotoDimensions(bytes);
    empty[p.section].push({
      bytes,
      type: detectImageType(p.filename),
      filename: p.filename ?? 'photo',
      width,
      height,
      label: p.label,
    });
  }
  return empty;
}

function photosTable(photos: SectionPhoto[]): Table | null {
  if (photos.length === 0) return null;

  // Layout : 1 photo par row, cellule pleine largeur (TW), paragraph
  // centré horizontalement, spacing { before: 200, after: 200 } pour
  // aérer entre les clichés. Label en italique muted centré sous chaque
  // photo. La largeur image elle-même est plafonnée à PHOTO_MAX_WIDTH_PX
  // (cap ~400px) via computePhotoDimensions, donc le centrage du Paragraph
  // gère l'alignement visuel sans avoir besoin de cellules vides.
  const rows: TableRow[] = photos.map((photo) => {
    const cellChildren: Paragraph[] = [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 200, after: photo.label ? 60 : 200 },
        children: [
          new ImageRun({
            data: photo.bytes,
            transformation: { width: photo.width, height: photo.height },
            type: photo.type,
          }),
        ],
      }),
    ];
    if (photo.label) {
      cellChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 200 },
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
    return new TableRow({
      children: [
        new TableCell({
          width: { size: TW, type: WidthType.DXA },
          children: cellChildren,
        }),
      ],
    });
  });

  const noBorder = { style: BorderStyle.NONE, size: 0, color: 'auto' };
  return new Table({
    width: { size: TW, type: WidthType.DXA },
    borders: {
      top: noBorder, bottom: noBorder, left: noBorder, right: noBorder,
      insideHorizontal: noBorder, insideVertical: noBorder,
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

  // Logo header — best-effort (si manquant, fallback texte "FoxO").
  // Largeur cible : 280px (cohérent avec la maquette FOXO_BASE).
  // Hauteur calculée dynamiquement depuis les vraies dimensions du PNG
  // pour préserver le ratio et éviter une déformation visuelle si l'asset
  // est remplacé (ex. nouveau logo "FoxO + Fox Group srl côte à côte"
  // ratio ≈ 2.95). Fallback 280×95 si image-size échoue.
  let logoBytes: Buffer | null = null;
  const logoWidth = 280;
  let logoHeight = 95;
  try {
    const logoPath = path.join(
      process.cwd(),
      'public',
      'foxo-logo-documents.png',
    );
    logoBytes = await fs.readFile(logoPath);
    const dim = imageSize(logoBytes);
    if (dim.width && dim.height) {
      logoHeight = Math.round(logoWidth * dim.height / dim.width);
    }
  } catch (e) {
    console.warn('[build-docx] logo introuvable:', e);
  }
  // fmtDate accessible aux callers ; ici utilisé uniquement si data.fait_a_date vide
  void fmtDate;

  // Photos par section (download Drive séquentiel pour préserver l'ordre).
  const photosBySection = await fetchPhotosBySection(args.interventionId);

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
                type: 'png',
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
  const sectionsConfig: { key: SectionKey; title: string; text: string }[] = [
    { key: 'degats',          title: 'Dégâts',         text: data.degats },
    { key: 'inspection',      title: 'Inspection',     text: data.inspection },
    { key: 'conclusion',      title: 'Conclusion',     text: data.conclusion },
    { key: 'recommandations', title: 'Recommandation', text: data.recommandation },
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

  // 4 sections : titre + corps (split sur ||PARA||) + photos rattachées
  for (const s of sectionsConfig) {
    bodyChildren.push(sectionTitle(s.title));
    bodyChildren.push(...textToParas(s.text));
    const tbl = photosTable(photosBySection[s.key]);
    if (tbl) bodyChildren.push(tbl);
  }

  // Clôture (alignée droite)
  bodyChildren.push(
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: 600 },
      children: [
        t('Fait à Bruxelles le,  ', { size: 22, italic: true, color: MUTED }),
        t(data.fait_a_date, { size: 22, italic: true, bold: true, color: DARK_BLUE }),
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
              // du contenu de l'en-tête/pied de page.
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
