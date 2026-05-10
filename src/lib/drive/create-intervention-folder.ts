// Création d'un dossier d'intervention dans Google Drive (racine RAPPORT
// plate, distincte de la hiérarchie RAPPORTS/[year]/ pilotée par le
// pipeline tech — cf. src/lib/google-drive.ts).
//
// Usage : pipeline mail → intervention. Quand un mail entrant est validé
// comme nouvelle demande, on alloue ici une référence "2026-NNN" en
// scannant les dossiers existants, on crée le dossier, on rend
// l'arborescence accessible en lecture publique pour partager le lien
// avec le syndic / occupants, puis on y dépose éventuellement les
// pièces jointes du mail (uploadAttachmentToFolder).
//
// Implémentation REST cohérente avec src/lib/google-drive.ts (fetch +
// getValidAccessToken depuis @/lib/google-auth, pas de SDK googleapis).

import { getValidAccessToken } from '@/lib/google-auth';
import { makeFilePublic } from '@/lib/google-drive';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

// Année préfixe des refs FoxO : actuellement hardcodée 2026 (cf. spec
// pipeline mail). Si la convention évolue (rotation annuelle), exposer
// en paramètre ou dériver de new Date().getFullYear().
const REF_YEAR = 2026;
const REF_REGEX = /^2026-(\d{3,})\s/;

// ─── Types exportés ────────────────────────────────────────────────────

export interface CreateInterventionFolderResult {
  folder_id: string;
  folder_name: string;
  ref: string;       // ex: "2026-148"
  number: number;    // ex: 148
  url: string;       // webViewLink Drive
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

interface DriveListResponse {
  files?: DriveFile[];
  nextPageToken?: string;
}

async function getRootFolderId(): Promise<string> {
  const id = process.env.DRIVE_RAPPORT_FOLDER_ID;
  if (!id || !id.trim()) {
    throw new Error('Drive: DRIVE_RAPPORT_FOLDER_ID manquante (cf. .env.example).');
  }
  return id.trim();
}

async function getAccessToken(): Promise<string> {
  const auth = await getValidAccessToken();
  if (!auth) {
    throw new Error('Drive: token Google indisponible (compte non connecté ou refresh échoué).');
  }
  return auth.access_token;
}

// Liste paginée de tous les sous-dossiers d'un parent (sans corbeille).
// Pas de filtre par nom ici : on doit scanner pour trouver le numéro
// max sur le préfixe d'année courant.
async function listChildFolders(token: string, parentId: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  // Garde-fou : si plus de ~10 pages (10 000 dossiers), le scan devient
  // suspect — la racine est probablement mal configurée.
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

function nextRefNumber(folders: DriveFile[]): number {
  let max = 0;
  for (const f of folders) {
    const m = REF_REGEX.exec(f.name);
    if (!m) continue;
    const n = Number.parseInt(m[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

async function createFolder(
  token: string,
  parentId: string,
  name: string,
): Promise<DriveFile> {
  const res = await fetch(`${DRIVE_API}/files?fields=id,name,webViewLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Drive: create folder ${res.status} — ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as DriveFile;
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

function buildWebViewLink(folder: DriveFile): string {
  return folder.webViewLink ?? `https://drive.google.com/drive/folders/${folder.id}`;
}

// ─── API publique ─────────────────────────────────────────────────────

export async function createInterventionFolder(
  adresse: string,
): Promise<CreateInterventionFolderResult> {
  try {
    const cleanedAdresse = adresse.trim().replace(/\s+/g, ' ');
    if (!cleanedAdresse) {
      throw new Error('Drive: adresse vide — impossible de nommer le dossier.');
    }

    const [rootId, token] = await Promise.all([getRootFolderId(), getAccessToken()]);

    // 1. Scanner la racine pour repérer le dernier numéro alloué.
    const folders = await listChildFolders(token, rootId);
    const number = nextRefNumber(folders);
    const ref = `${REF_YEAR}-${String(number).padStart(3, '0')}`;
    const folder_name = `${ref} ${cleanedAdresse}`;

    // 2. Créer le dossier d'intervention.
    const created = await createFolder(token, rootId, folder_name);

    // 3. Rendre lisible publiquement (best-effort — partagé par lien).
    //    makeFilePublic est noop sur erreur, donc on n'interrompt pas
    //    la création si Drive refuse l'élévation de permissions.
    await makeFilePublic(created.id, token);

    return {
      folder_id: created.id,
      folder_name: created.name,
      ref,
      number,
      url: buildWebViewLink(created),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'erreur inconnue';
    console.error('[drive/create-intervention-folder] createInterventionFolder failed:', msg);
    if (e instanceof Error && e.message.startsWith('Drive:')) throw e;
    throw new Error(`Drive: impossible de créer le dossier — ${msg}`);
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
