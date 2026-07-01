// Photos du rapport — source de données PARTAGÉE entre le moteur docx
// (build-docx.ts) et le moteur PDF (RapportPdf via dispatch.ts), pour un rendu
// strictement jumeau.
//
// Règle métier (validée Foxo) : seules les photos des sections DÉGÂTS et
// INSPECTION sont affichées (en fin de section), triées par `ordre`. Les
// octets sont téléchargés depuis Google Drive (drive_file_id), normalisés en
// JPEG via sharp (gère webp/heic + orientation EXIF) et leurs dimensions
// intrinsèques sont retournées pour que chaque moteur calcule sa taille
// d'affichage en préservant le ratio. Best-effort : une photo dont le
// téléchargement/décodage échoue est omise (console.warn), jamais bloquant.

import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createAdminClient } from '@/lib/supabase/admin';
import { getValidAccessToken } from '@/lib/google-auth';

export type RapportPhotoData = {
  bytes: Buffer;          // JPEG normalisé
  width: number;          // dimension intrinsèque (px)
  height: number;         // dimension intrinsèque (px)
  label: string | null;   // légende (photos_interventions.label)
  ancrage_para: number | null; // index 1-based du paragraphe d'ancrage, ou null (fin de section)
};

export type RapportPhotosBySection = {
  degats: RapportPhotoData[];
  inspection: RapportPhotoData[];
};

const SECTIONS = ['degats', 'inspection'] as const;
type PhotoSection = (typeof SECTIONS)[number];

const FALLBACK_W = 1200;
const FALLBACK_H = 900;

async function downloadDriveBytes(fileId: string, token: string): Promise<Buffer | null> {
  try {
    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  }
}

// Normalise en JPEG (orientation EXIF appliquée) et retourne bytes + dims.
async function toJpegWithDims(raw: Buffer): Promise<{ bytes: Buffer; width: number; height: number } | null> {
  try {
    const bytes = await sharp(raw).rotate().jpeg({ quality: 82 }).toBuffer();
    const meta = await sharp(bytes).metadata();
    return { bytes, width: meta.width ?? FALLBACK_W, height: meta.height ?? FALLBACK_H };
  } catch {
    return null;
  }
}

export async function fetchRapportPhotos(interventionId: string): Promise<RapportPhotosBySection> {
  const empty: RapportPhotosBySection = { degats: [], inspection: [] };

  const admin = createAdminClient();
  const { data } = await admin
    .from('photos_interventions')
    .select('drive_file_id, annotated_drive_file_id, filename, section, ordre, label, ancrage_para')
    .eq('intervention_id', interventionId)
    .in('section', SECTIONS as unknown as string[])   // DÉGÂTS + INSPECTION uniquement
    .order('section', { ascending: true })
    .order('ordre', { ascending: true });

  const rows = (data ?? []) as Array<{
    drive_file_id: string | null;
    annotated_drive_file_id: string | null;
    filename: string | null;
    section: PhotoSection;
    ordre: number;
    label: string | null;
    ancrage_para: number | null;
  }>;
  if (rows.length === 0) return empty;

  const auth = await getValidAccessToken();
  if (!auth) { console.warn('[rapport/photos] Google non connecté — aucune photo embarquée.'); return empty; }

  // Dédoublonnage 1/2 — par fichier source : deux lignes pointant vers la même
  // image Drive ne sont téléchargées/affichées qu'une fois (garde la première).
  const seenFile = new Set<string>();
  // Dédoublonnage 2/2 — par contenu : deux fichiers distincts aux octets
  // identiques (même photo importée deux fois) ne s'affichent qu'une fois.
  const seenHash = new Set<string>();

  for (const p of rows) {
    const fileId = p.annotated_drive_file_id ?? p.drive_file_id;
    if (!fileId || seenFile.has(fileId)) continue;
    seenFile.add(fileId);
    const raw = await downloadDriveBytes(fileId, auth.access_token);
    if (!raw) { console.warn(`[rapport/photos] download échoué (section ${p.section})`); continue; }
    const norm = await toJpegWithDims(raw);
    if (!norm) { console.warn(`[rapport/photos] décodage échoué (section ${p.section})`); continue; }
    const hash = createHash('sha1').update(norm.bytes).digest('hex');
    if (seenHash.has(hash)) continue; // doublon strict (même image)
    seenHash.add(hash);
    empty[p.section].push({ bytes: norm.bytes, width: norm.width, height: norm.height, label: p.label, ancrage_para: p.ancrage_para });
  }
  return empty;
}
