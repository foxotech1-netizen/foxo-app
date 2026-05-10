// Helpers Drive pour le pipeline mail → intervention.
//
// La création du dossier d'intervention elle-même est déléguée à
// `createInterventionFolder` de @/lib/google-drive (structure
// hiérarchique RAPPORTS/{year}/{ref + adresse}/photos/, idempotente
// via ensureFolder). Ce module ne contient que les briques manquantes :
//
//   - uploadAttachmentToFolder : dépose une pièce jointe Gmail (base64)
//     dans un dossier Drive existant via upload multipart.
//
// Implémentation REST cohérente avec src/lib/google-drive.ts (fetch +
// getValidAccessToken depuis @/lib/google-auth, pas de SDK googleapis).

import { getValidAccessToken } from '@/lib/google-auth';

const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

// ─── Types exportés ────────────────────────────────────────────────────

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
