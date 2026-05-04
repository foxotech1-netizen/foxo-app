// Génération du rapport au format Microsoft Word (.docx) selon le
// template FoxO Rapport v3. Le .docx est uploadé sur Drive à côté du
// PDF (cf. lib/rapport/dispatch.ts) — il sert de base éditable pour
// les retouches manuelles avant envoi définitif.
//
// Photos : récupérées depuis photos_interventions (lien section + ordre,
// cf. migration 2026-05-28_photos_section.sql) ; bytes téléchargés via
// l'API Drive avec le drive_file_id et le token OAuth FoxO.
//
// Règles rédactionnelles FoxO conservées : prose uniquement (pas de
// listes à puces), formulation prudente pour les causes incertaines,
// terminologie « capteur d'humidité » plutôt que « hygromètre ».

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
  WidthType,
  ShadingType,
} from 'docx';
import fs from 'node:fs/promises';
import path from 'node:path';
import { imageSize } from 'image-size';
import { createAdminClient } from '@/lib/supabase/admin';
import { getValidAccessToken } from '@/lib/google-auth';

// ─── Constantes du template ────────────────────────────────────────────

const PAGE_W = 11906;
const PAGE_H = 16838;
const MARGIN = 720;
const TW = 10466;

const DARK_BLUE = '1B3A5C';
const MID_BLUE = '2E75B6';
const ACCENT_LINE = '4A9FD4';
const LIGHT_BLUE = 'EAF4FB';
const BODY_TEXT = '1A1A1A';
const MUTED = '6B6B6B';
const DIVIDER = 'C0D4E8';

const FONT = 'Calibri';

// Hauteur fixe 302 px ; largeur calculée proportionnellement à partir
// des dimensions réelles de chaque image (lib `image-size`). On clampe
// la largeur à la moitié de la zone tappable pour conserver le layout
// 2-cols. Si `image-size` échoue (format inconnu, fichier corrompu),
// on retombe sur un ratio 4:3 par défaut.
const PHOTO_HEIGHT_PX = 302;
const PHOTO_FALLBACK_WIDTH_PX = 403; // 302 * 4/3
// Largeur max d'une cellule photo en pixels (TW twips → px @ 96 dpi).
const PHOTO_MAX_WIDTH_PX = Math.floor(((TW - 160) / 2) * 96 / 1440);

// ─── Helpers ───────────────────────────────────────────────────────────

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
  width: number;  // px — déjà clampé à PHOTO_MAX_WIDTH_PX
  height: number; // px — toujours PHOTO_HEIGHT_PX (sauf si dimensions plus
                  //   petites que ça après clamp largeur, auquel cas on
                  //   réduit aussi la hauteur pour conserver le ratio).
}

// Calcule (width, height) en pixels pour une photo donnée :
//   - hauteur cible PHOTO_HEIGHT_PX
//   - largeur calculée au ratio réel de l'image
//   - clamp largeur ≤ PHOTO_MAX_WIDTH_PX (avec ajustement hauteur)
// Retombe sur (PHOTO_FALLBACK_WIDTH_PX, PHOTO_HEIGHT_PX) si lecture KO.
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
    .select('drive_file_id, drive_url, filename, section, ordre')
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
    });
  }
  return empty;
}

// ─── Builders de blocs Word ────────────────────────────────────────────

function labelRun(text: string): TextRun {
  return new TextRun({ text, bold: true, color: DARK_BLUE, size: 20, font: FONT });
}

function valueRun(text: string): TextRun {
  return new TextRun({ text: text || '—', size: 20, color: BODY_TEXT, font: FONT });
}

function labelCell(width: number, text: string): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: { type: ShadingType.SOLID, color: LIGHT_BLUE, fill: LIGHT_BLUE },
    children: [new Paragraph({ children: [labelRun(text)] })],
  });
}

function valueCell(width: number, text: string, columnSpan?: number): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    columnSpan,
    children: [new Paragraph({ children: [valueRun(text)] })],
  });
}

function buildIdentificationTable(args: {
  ref: string;
  adresse: string;
  acp_nom: string;
  date: Date;
  description: string;
}): Table {
  const C1 = 1900;
  const C2 = 3333;
  const C3 = 1900;
  const C4 = 3333;
  const VALUE_FULL = C2 + C3 + C4;

  // Techniques : checkboxes — par défaut Capteur d'humidité ✓ et
  // Inspection visuelle ✓ ; les autres ☐. Le tech peut éditer le
  // .docx pour cocher d'autres techniques avant envoi.
  const techniques = [
    { label: 'Inspection visuelle',     checked: true  },
    { label: "Capteur d'humidité",      checked: true  },
    { label: 'Acoustique',              checked: false },
    { label: 'Caméra thermique',        checked: false },
    { label: 'Caméra endoscopique',     checked: false },
    { label: 'Traceur fluorescent',     checked: false },
  ];
  const techniquesText = techniques
    .map((t) => `${t.checked ? '☑' : '☐'} ${t.label}`)
    .join('   ');

  return new Table({
    width: { size: TW, type: WidthType.DXA },
    columnWidths: [C1, C2, C3, C4],
    rows: [
      new TableRow({
        children: [
          labelCell(C1, 'N° Intervention'),
          valueCell(C2, args.ref),
          labelCell(C3, 'Date'),
          valueCell(C4, fmtDate(args.date)),
        ],
      }),
      new TableRow({
        children: [
          labelCell(C1, 'Objet intervention'),
          valueCell(VALUE_FULL, args.description, 3),
        ],
      }),
      new TableRow({
        children: [
          labelCell(C1, 'Adresse facturation'),
          valueCell(VALUE_FULL, args.acp_nom || '—', 3),
        ],
      }),
      new TableRow({
        children: [
          labelCell(C1, "Adresse d'intervention"),
          valueCell(VALUE_FULL, args.adresse || '—', 3),
        ],
      }),
      new TableRow({
        children: [
          labelCell(C1, 'Techniques'),
          valueCell(VALUE_FULL, techniquesText, 3),
        ],
      }),
    ],
  });
}

function sectionTitle(title: string): Paragraph[] {
  return [
    new Paragraph({
      spacing: { before: 320, after: 60 },
      children: [
        new TextRun({
          text: title,
          bold: true,
          allCaps: true,
          color: DARK_BLUE,
          size: 32,
          font: FONT,
        }),
      ],
      border: {
        bottom: {
          style: BorderStyle.SINGLE,
          color: ACCENT_LINE,
          size: 12,
          space: 4,
        },
      },
    }),
  ];
}

function sectionBody(text: string): Paragraph[] {
  const trimmed = text?.trim() ?? '';
  if (!trimmed) {
    return [
      new Paragraph({
        spacing: { before: 100, after: 100, line: 360 },
        children: [
          new TextRun({
            text: '—',
            italics: true,
            color: MUTED,
            size: 21,
            font: FONT,
          }),
        ],
      }),
    ];
  }
  // Préserve les retours-ligne en créant un Paragraph par bloc.
  return trimmed.split(/\r?\n\r?\n/).map((para) =>
    new Paragraph({
      spacing: { before: 100, after: 100, line: 360 },
      children: [
        new TextRun({
          text: para.replace(/\r?\n/g, ' '),
          size: 21,
          color: BODY_TEXT,
          font: FONT,
        }),
      ],
    }),
  );
}

function photosTable(photos: SectionPhoto[]): Table | null {
  if (photos.length === 0) return null;
  const cellW = Math.floor((TW - 160) / 2);

  // Construit les lignes par paires de 2 photos.
  const rows: TableRow[] = [];
  for (let i = 0; i < photos.length; i += 2) {
    const left = photos[i];
    const right = photos[i + 1];
    const cells: TableCell[] = [
      new TableCell({
        width: { size: cellW, type: WidthType.DXA },
        children: [
          new Paragraph({
            alignment: left && !right ? AlignmentType.CENTER : AlignmentType.LEFT,
            children: [
              new ImageRun({
                data: left.bytes,
                transformation: { width: left.width, height: left.height },
                type: left.type,
              }),
            ],
          }),
        ],
      }),
    ];
    if (right) {
      cells.push(
        new TableCell({
          width: { size: cellW, type: WidthType.DXA },
          children: [
            new Paragraph({
              children: [
                new ImageRun({
                  data: right.bytes,
                  transformation: { width: right.width, height: right.height },
                  type: right.type,
                }),
              ],
            }),
          ],
        }),
      );
    } else {
      // Cellule vide pour conserver le layout 2-cols
      cells.push(
        new TableCell({
          width: { size: cellW, type: WidthType.DXA },
          children: [new Paragraph({ children: [] })],
        }),
      );
    }
    rows.push(new TableRow({ children: cells }));
  }

  // Pas de bordures (table invisible — sert juste au layout).
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

// ─── Fonction publique ─────────────────────────────────────────────────

export async function buildRapportDocx(args: {
  interventionId: string;
  ref: string;
  adresse: string;
  acp_nom: string;
  date: Date;
  sections: {
    degats: string;
    inspection: string;
    conclusion: string;
    recommandations: string;
  };
}): Promise<Uint8Array> {
  // Logo header — best-effort (si manquant, on rend juste "FoxO" texte).
  let logoBytes: Buffer | null = null;
  try {
    const logoPath = path.join(
      process.cwd(),
      'public',
      'foxo-logo-noir-transparent.png',
    );
    logoBytes = await fs.readFile(logoPath);
  } catch (e) {
    console.warn('[build-docx] logo introuvable:', e);
  }

  // Photos par section (download Drive en parallèle implicite via le for).
  const photosBySection = await fetchPhotosBySection(args.interventionId);

  // ─── Header ───────────────────────────────────────────────────────────
  const header = new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        children: logoBytes
          ? [
              new ImageRun({
                data: logoBytes,
                transformation: { width: 205, height: 108 },
                type: 'png',
              }),
            ]
          : [new TextRun({ text: 'FoxO', bold: true, size: 36, color: DARK_BLUE, font: FONT })],
      }),
      // Ligne séparatrice sous le logo
      new Paragraph({
        border: {
          bottom: { style: BorderStyle.SINGLE, color: DARK_BLUE, size: 8, space: 1 },
        },
        children: [],
      }),
    ],
  });

  // ─── Footer ───────────────────────────────────────────────────────────
  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: 'Fox Group srl · Stationstraat 55, 3070 Kortenberg · info@foxo.be · +32 488 700 007',
            size: 16,
            color: MUTED,
            font: FONT,
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: 'TVA : BE1030.109.019 · BEOBANK : BE62 9502 6652 9861',
            size: 16,
            color: MUTED,
            font: FONT,
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: '© 2026 Fox Group srl – Tous droits réservés – Rapport technique',
            size: 14,
            color: MUTED,
            italics: true,
            font: FONT,
          }),
        ],
      }),
    ],
  });

  // ─── Children du body ────────────────────────────────────────────────
  const sectionsConfig: { key: SectionKey; title: string; text: string }[] = [
    { key: 'degats',          title: 'Dégâts',         text: args.sections.degats },
    { key: 'inspection',      title: 'Inspection',     text: args.sections.inspection },
    { key: 'conclusion',      title: 'Conclusion',     text: args.sections.conclusion },
    { key: 'recommandations', title: 'Recommandation', text: args.sections.recommandations },
  ];

  const bodyChildren: (Paragraph | Table)[] = [
    // Titre principal
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 400 },
      children: [
        new TextRun({
          text: "RAPPORT D'INTERVENTION",
          bold: true,
          allCaps: true,
          color: DARK_BLUE,
          size: 48,
          font: FONT,
        }),
      ],
    }),

    // Tableau identification (5 lignes)
    buildIdentificationTable({
      ref: args.ref,
      adresse: args.adresse,
      acp_nom: args.acp_nom,
      date: args.date,
      description: args.sections.degats?.split(/\r?\n/)[0]?.slice(0, 200) || '—',
    }),

    new Paragraph({ spacing: { before: 200, after: 200 }, children: [] }),
  ];

  // 4 sections + photos
  for (const s of sectionsConfig) {
    bodyChildren.push(...sectionTitle(s.title));
    bodyChildren.push(...sectionBody(s.text));
    const tbl = photosTable(photosBySection[s.key]);
    if (tbl) bodyChildren.push(tbl);
  }

  // Clôture (alignée droite)
  bodyChildren.push(
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: 600 },
      children: [
        new TextRun({
          text: `Fait à Bruxelles le, ${fmtDate(args.date)}`,
          size: 22,
          italics: true,
          color: MUTED,
          font: FONT,
        }),
      ],
    }),
  );

  // ─── Document ─────────────────────────────────────────────────────────
  const doc = new Document({
    creator: 'FoxO',
    title: `Rapport ${args.ref}`,
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
              top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN,
              header: 360, footer: 360,
            },
            borders: {
              pageBorderTop:    { style: BorderStyle.SINGLE, size: 18, color: DARK_BLUE, space: 24 },
              pageBorderRight:  { style: BorderStyle.SINGLE, size: 18, color: DARK_BLUE, space: 24 },
              pageBorderBottom: { style: BorderStyle.SINGLE, size: 18, color: DARK_BLUE, space: 24 },
              pageBorderLeft:   { style: BorderStyle.SINGLE, size: 18, color: DARK_BLUE, space: 24 },
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

// Couleurs et constantes utilitaires conservées au cas où elles seraient
// utilisées plus tard (legend, sub-section, etc.)
void MID_BLUE;
void DIVIDER;
