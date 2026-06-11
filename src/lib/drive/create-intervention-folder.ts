// Helpers Drive pour le pipeline mail → intervention.
//
// La création du dossier d'intervention elle-même est déléguée à
// `createInterventionFolder` de @/lib/google-drive (structure
// hiérarchique RAPPORTS/{year}/{ref + adresse}/photos/, idempotente
// via ensureFolder). Ce module orchestre :
//
//   - listDriveFolderNumbers : scanne RAPPORTS/{year}/ et retourne la
//     liste des numéros parsés (consommé par nextRefForYear pour
//     croiser DB + Drive — cf. src/lib/intervention-ref.ts).
//   - createInterventionFolderFromMail : crée le dossier Drive pour
//     une ref donnée (allouée par nextRefForYear côté caller).
//   - uploadAttachmentToFolder : dépose une pièce jointe Gmail (base64)
//     dans un dossier Drive existant via upload multipart.
//
// Implémentation REST cohérente avec src/lib/google-drive.ts (fetch +
// getValidAccessToken depuis @/lib/google-auth, pas de SDK googleapis).

import { getValidAccessToken } from '@/lib/google-auth';
import { getDriveFolders } from '@/lib/drive/config';
import {
  createInterventionFolder as createInterventionFolderHierarchical,
  ensureFolder,
} from '@/lib/google-drive';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

// ─── Types exportés ────────────────────────────────────────────────────

export interface CreateInterventionFolderFromMailResult {
  driveFolderId: string;
  driveUrl: string;
  folder_name: string;
}

export interface UploadAttachmentParams {
  folder_id: string;
  filename: string;
  mime_type: string;
  data_base64: string;
}

export interface UploadAttachmentResult {
  file_id: string;
  url: string;
}

// ─── Helpers internes ─────────────────────────────────────────────────

interface DriveFile {
  id: string;
  name: string;
  webViewLink?: string;
}

async function getAccessToken(): Promise<string> {
  const auth = await getValidAccessToken();
  if (!auth) {
    throw new Error('Drive: token Google indisponible (compte non connecté ou refresh échoué).');
  }
  return auth.access_token;
}

// Racine RAPPORTS via la config centralisée (@/lib/drive/config) — throw une
// Error explicite si la variable d'env manque (chemin strict, le caller
// décide du fallback).
function getRapportsRootId(): string {
  return getDriveFolders().rapportsFolderId;
}

// Liste paginée de tous les sous-dossiers d'un parent (sans corbeille).
// Pas de filtre par nom : on doit scanner pour trouver le numéro max
// sur le préfixe d'année. 10 pages max (10 000 dossiers) — au-delà la
// racine est probablement mal configurée.
interface DriveListResponse {
  files?: DriveFile[];
  nextPageToken?: string;
}
async function listChildFolders(token: string, parentId: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const q = `'${parentId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`;
    const params = new URLSearchParams({
      q,
      fields: 'nextPageToken,files(id,name)',
      pageSize: '1000',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await fetch(`${DRIVE_API}/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Drive: list folders ${res.status} — ${detail.slice(0, 200)}`);
    }
    const j = (await res.json()) as DriveListResponse;
    if (j.files) out.push(...j.files);
    if (!j.nextPageToken) return out;
    pageToken = j.nextPageToken;
  }
  return out;
}

// Décodage base64 standard ou URL-safe (Gmail API renvoie de l'URL-safe).
// Tolère le padding manquant.
function decodeBase64(input: string): Uint8Array {
  const cleaned = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = cleaned.length % 4 === 0 ? '' : '='.repeat(4 - (cleaned.length % 4));
  return new Uint8Array(Buffer.from(cleaned + padding, 'base64'));
}

// Upload multipart Drive (metadata + bytes en un seul POST). Identique
// au pattern privé de src/lib/google-drive.ts mais ré-implémenté ici
// pour ne pas exposer un helper transversal supplémentaire.
async function uploadMultipart(
  token: string,
  parentId: string,
  filename: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<DriveFile> {
  const boundary = '----foxo' + Math.random().toString(36).slice(2);
  // mimeType dans le metadata bloque la conversion auto Drive (sinon un
  // .docx peut être converti en Google Doc natif).
  const metadata = JSON.stringify({ name: filename, parents: [parentId], mimeType });
  const pre = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const post = `\r\n--${boundary}--`;

  const preBuf = new TextEncoder().encode(pre);
  const postBuf = new TextEncoder().encode(post);
  const body = new Uint8Array(preBuf.length + bytes.length + postBuf.length);
  body.set(preBuf, 0);
  body.set(bytes, preBuf.length);
  body.set(postBuf, preBuf.length + bytes.length);

  const res = await fetch(`${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,webViewLink&convert=false`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: body as unknown as BodyInit,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Drive: upload ${filename} — ${res.status} ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as DriveFile;
}

// ─── API publique ─────────────────────────────────────────────────────

// Scanne RAPPORTS/{yearStr}/ et retourne la liste des numéros entiers
// parsés (sans dédoublonnage, sans tri, sans +1). Utilise la même regex
// que l'ancien generateNextRef : `^{yearStr}-(\d{3,})\s`.
//
// Consommée par nextRefForYear (src/lib/intervention-ref.ts) qui croise
// ce résultat avec le MAX(ref) de la table interventions pour produire
// la prochaine ref unifiée DB+Drive.
//
// Throw sur toute erreur Drive (token absent, root_id mal configuré,
// échec list folders). Le caller décide du fallback DB-only.
export async function listDriveFolderNumbers(yearStr: string): Promise<number[]> {
  const [rootId, token] = await Promise.all([
    Promise.resolve(getRapportsRootId()),
    getAccessToken(),
  ]);

  const yearFolder = await ensureFolder(token, rootId, yearStr);
  if (!yearFolder) {
    throw new Error(`Drive: échec création/accès dossier année ${yearStr}.`);
  }

  const children = await listChildFolders(token, yearFolder.id);
  const refRegex = new RegExp(`^${yearStr}-(\\d{3,})\\s`);
  const out: number[] = [];
  for (const f of children) {
    const m = refRegex.exec(f.name);
    if (!m) continue;
    const n = Number.parseInt(m[1], 10);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

// Crée le dossier d'intervention Drive pour une ref donnée. La ref est
// allouée en amont par nextRefForYear (src/lib/intervention-ref.ts) —
// cette fonction ne fait QUE la création du dossier hiérarchique.
//
// Le folder_name est reconstruit côté wrapper pour le retourner — la
// fonction sous-jacente applique le même format
// `${ref} ${adresse}`.trim().slice(0, 200) en interne.
export async function createInterventionFolderFromMail(
  ref: string,
  adresse: string,
): Promise<CreateInterventionFolderFromMailResult> {
  try {
    const cleanedAdresse = adresse.trim().replace(/\s+/g, ' ');
    if (!cleanedAdresse) {
      throw new Error('Drive: adresse vide — impossible de nommer le dossier.');
    }
    if (!ref.trim()) {
      throw new Error('Drive: ref vide — impossible de nommer le dossier.');
    }
    const year = new Date().getFullYear();

    const result = await createInterventionFolderHierarchical({ ref, adresse: cleanedAdresse, year });
    if (!result.ok) {
      throw new Error(`Drive: création dossier intervention — ${result.error}`);
    }

    // Reproduit la troncature appliquée par createInterventionFolder
    // (cf. google-drive.ts:207) — garantit que le folder_name retourné
    // matche exactement ce qui a été créé sur Drive.
    const folder_name = `${ref} ${cleanedAdresse}`.trim().slice(0, 200);

    return {
      driveFolderId: result.folder_id,
      driveUrl: result.web_view_link,
      folder_name,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'erreur inconnue';
    console.error('[drive/create-intervention-folder] createInterventionFolderFromMail failed:', msg);
    if (e instanceof Error && e.message.startsWith('Drive:')) throw e;
    throw new Error(`Drive: impossible de créer le dossier d'intervention — ${msg}`);
  }
}

export async function uploadAttachmentToFolder(
  params: UploadAttachmentParams,
): Promise<UploadAttachmentResult> {
  try {
    if (!params.folder_id.trim()) throw new Error('Drive: folder_id vide.');
    if (!params.filename.trim()) throw new Error('Drive: filename vide.');

    const token = await getAccessToken();
    const bytes = decodeBase64(params.data_base64);
    if (bytes.byteLength === 0) {
      throw new Error('Drive: pièce jointe vide après décodage base64.');
    }

    const file = await uploadMultipart(
      token,
      params.folder_id,
      params.filename,
      bytes,
      params.mime_type || 'application/octet-stream',
    );

    return {
      file_id: file.id,
      url: file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'erreur inconnue';
    console.error('[drive/create-intervention-folder] uploadAttachmentToFolder failed:', msg);
    if (e instanceof Error && e.message.startsWith('Drive:')) throw e;
    throw new Error(`Drive: impossible d'uploader la pièce jointe — ${msg}`);
  }
}
