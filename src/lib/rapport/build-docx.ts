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
  label: string | null; // légende affichée sous l'image (italique muted)
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

// Comme valueCell, mais préserve les retours-ligne en créant un Paragraph
// par ligne. Utilisé pour les cellules multi-lignes du tableau d'identification
// (Adresse Facturation, Adresse d'intervention, description longue).
function multiLineCell(width: number, text: string, columnSpan?: number): TableCell {
  const lines = (text || '—').split(/\r?\n/);
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    columnSpan,
    children: lines.map((line) => new Paragraph({
      children: [new TextRun({
        text: line,
        size: 20,
        color: BODY_TEXT,
        font: FONT,
      })],
    })),
  });
}

// Layout 2 colonnes du template FoxO 2026-104 : 4 techniques à gauche,
// 4 à droite. Chaque label peut être coché à partir d'un ou plusieurs
// test_type provenant des observations terrain (alias loose).
const TECHNIQUE_LEFT: readonly string[] = [
  "Capteur d'humidité",
  'Thermographie infrarouge',
  'Caméra endoscopique',
  'Liquide traceur',
];
const TECHNIQUE_RIGHT: readonly string[] = [
  'Détection acoustique',
  'Test pression / Compteur',
  'Gaz traceur',
  'Inspection visuelle',
];

// Mapping label Word → test_types observations. Quand une observation
// matche un alias, la checkbox correspondante est cochée. Une entrée
// vide signifie qu'aucun test_type courant ne déclenche cette case
// (Détection acoustique et Gaz traceur ne sont pas dans TEST_TYPES UI).
const TECHNIQUE_TRIGGERS: Record<string, readonly string[]> = {
  "Capteur d'humidité":       ["Capteur d'humidité"],
  'Thermographie infrarouge': ['Thermographie'],
  'Caméra endoscopique':      ['Caméra endoscopique'],
  'Liquide traceur':          ['Test colorant'],
  'Détection acoustique':     [],
  'Test pression / Compteur': ['Test de pression'],
  'Gaz traceur':              [],
  'Inspection visuelle':      ['Inspection visuelle'],
};

function isTechniqueChecked(label: string, testedSet: Set<string>): boolean {
  const triggers = TECHNIQUE_TRIGGERS[label] ?? [];
  return triggers.some((t) => testedSet.has(t));
}

// Génère un Paragraph par technique avec ☑ si test mené, ☐ sinon.
function techniqueParagraphs(labels: readonly string[], testedSet: Set<string>): Paragraph[] {
  return labels.map((label) => {
    const checked = isTechniqueChecked(label, testedSet);
    return new Paragraph({
      spacing: { before: 40, after: 40 },
      children: [
        new TextRun({
          text: `${checked ? '☑' : '☐'} ${label}`,
          size: 18,
          color: checked ? DARK_BLUE : BODY_TEXT,
          bold: checked,
          font: FONT,
        }),
      ],
    });
  });
}

function buildIdentificationTable(args: {
  ref: string;
  refSyndic: string | null;
  description: string;
  adresseFacturation: string;
  adresseIntervention: string;
  testedSet: Set<string>;
}): Table {
  const C1 = 1900;
  const C2 = 3333;
  const C3 = 1900;
  const C4 = 3333;
  const VALUE_FULL = C2 + C3 + C4;
  const LEFT_TECHS = C2 + C3; // span 2

  return new Table({
    width: { size: TW, type: WidthType.DXA },
    columnWidths: [C1, C2, C3, C4],
    rows: [
      // Row 1 : N° Intervention | ref | Réf. syndic | refSyndic ou —
      new TableRow({
        children: [
          labelCell(C1, 'N° Intervention'),
          valueCell(C2, args.ref),
          labelCell(C3, 'Réf. syndic'),
          valueCell(C4, args.refSyndic || '—'),
        ],
      }),
      // Row 2 : Objet intervention | description | Adresse Facturation | facturation
      new TableRow({
        children: [
          labelCell(C1, 'Objet intervention'),
          multiLineCell(C2, args.description),
          labelCell(C3, 'Adresse Facturation'),
          multiLineCell(C4, args.adresseFacturation),
        ],
      }),
      // Row 3 : Adresse d'intervention | adresse multi-lignes (span 3)
      new TableRow({
        children: [
          labelCell(C1, "Adresse d'intervention"),
          multiLineCell(VALUE_FULL, args.adresseIntervention, 3),
        ],
      }),
      // Row 4 : Techniques d'inspection | col gauche (C2+C3) | col droite (C4)
      new TableRow({
        children: [
          labelCell(C1, "Techniques d'inspection"),
          new TableCell({
            width: { size: LEFT_TECHS, type: WidthType.DXA },
            columnSpan: 2,
            children: techniqueParagraphs(TECHNIQUE_LEFT, args.testedSet),
          }),
          new TableCell({
            width: { size: C4, type: WidthType.DXA },
            children: techniqueParagraphs(TECHNIQUE_RIGHT, args.testedSet),
          }),
        ],
      }),
    ],
  });
}

// Tableau 3 colonnes (test_type / loc / notes) sans bordure pour la
// section Observations terrain. Aligné sur la largeur tappable TW.
function buildObservationsTable(observations: Array<{
  test_type: string;
  etage: string | null;
  localisation: string | null;
  notes: string | null;
}>): Table {
  const C1 = 3140;  // 30 %
  const C2 = 2617;  // 25 %
  const C3 = 4709;  // 45 %
  const noBorder = { style: BorderStyle.NONE, size: 0, color: 'auto' };
  const rows = observations.map((o) => {
    const loc = [o.etage ? `Étage ${o.etage}` : null, o.localisation]
      .filter(Boolean)
      .join(' — ');
    return new TableRow({
      children: [
        new TableCell({
          width: { size: C1, type: WidthType.DXA },
          children: [new Paragraph({
            spacing: { before: 80, after: 80 },
            children: [new TextRun({
              text: o.test_type,
              bold: true,
              size: 20,
              color: BODY_TEXT,
              font: FONT,
            })],
          })],
        }),
        new TableCell({
          width: { size: C2, type: WidthType.DXA },
          children: [new Paragraph({
            spacing: { before: 80, after: 80 },
            children: [new TextRun({
              text: loc || '—',
              size: 20,
              color: BODY_TEXT,
              font: FONT,
            })],
          })],
        }),
        new TableCell({
          width: { size: C3, type: WidthType.DXA },
          children: [new Paragraph({
            spacing: { before: 80, after: 80 },
            children: [new TextRun({
              text: o.notes || '—',
              italics: true,
              size: 20,
              color: MUTED,
              font: FONT,
            })],
          })],
        }),
      ],
    });
  });
  return new Table({
    width: { size: TW, type: WidthType.DXA },
    borders: {
      top: noBorder, bottom: noBorder, left: noBorder, right: noBorder,
      insideHorizontal: noBorder, insideVertical: noBorder,
    },
    rows,
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
          ...(left.label ? [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({
              text: left.label,
              size: 18,
              color: MUTED,
              italics: true,
              font: FONT,
            })],
          })] : []),
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
            ...(right.label ? [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({
                text: right.label,
                size: 18,
                color: MUTED,
                italics: true,
                font: FONT,
              })],
            })] : []),
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
  refSyndic: string | null;
  description: string;            // multi-lignes autorisées
  adresseFacturation: string;     // multi-lignes (nom, adresse, email, BCE)
  adresseIntervention: string;    // multi-lignes (ACP, adresse, étages)
  date: Date;
  sections: {
    degats: string;
    inspection: string;
    conclusion: string;
    recommandations: string;
  };
  observations?: Array<{
    test_type: string;
    etage: string | null;
    localisation: string | null;
    notes: string | null;
  }>;
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
            text: '© 2026 Fox Group srl – Tous droits réservés – Rapport technique – Modèle propriétaire – Reproduction interdite',
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

    // Tableau identification 4 lignes (template FoxO 2026-104) : ref+ref_syndic,
    // objet+factu, adresse intervention, techniques en 2 colonnes.
    buildIdentificationTable({
      ref: args.ref,
      refSyndic: args.refSyndic,
      description: args.description,
      adresseFacturation: args.adresseFacturation,
      adresseIntervention: args.adresseIntervention,
      testedSet: new Set((args.observations ?? []).map((o) => o.test_type)),
    }),

    new Paragraph({ spacing: { before: 200, after: 200 }, children: [] }),
  ];

  // 4 sections + photos. Insertion d'« Observations terrain » entre
  // Inspection et Conclusion si des observations existent.
  for (const s of sectionsConfig) {
    bodyChildren.push(...sectionTitle(s.title));
    bodyChildren.push(...sectionBody(s.text));
    const tbl = photosTable(photosBySection[s.key]);
    if (tbl) bodyChildren.push(tbl);
    if (s.key === 'inspection' && args.observations && args.observations.length > 0) {
      bodyChildren.push(...sectionTitle('Observations terrain'));
      bodyChildren.push(buildObservationsTable(args.observations));
    }
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
