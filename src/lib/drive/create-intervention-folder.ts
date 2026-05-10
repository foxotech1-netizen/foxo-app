// Helpers Drive pour le pipeline mail → intervention.
//
// La création du dossier d'intervention elle-même est déléguée à
// `createInterventionFolder` de @/lib/google-drive (structure
// hiérarchique RAPPORTS/{year}/{ref + adresse}/photos/, idempotente
// via ensureFolder). Ce module orchestre :
//
//   - generateNextRef : alloue la prochaine référence "AAAA-NNN" pour
//     une année donnée en scannant les sous-dossiers de RAPPORTS/{year}/.
//   - createInterventionFolderFromMail : wrapper one-shot qui combine
//     generateNextRef + createInterventionFolder de google-drive.ts
//     pour le flux mail entrant.
//   - uploadAttachmentToFolder : dépose une pièce jointe Gmail (base64)
//     dans un dossier Drive existant via upload multipart.
//
// Implémentation REST cohérente avec src/lib/google-drive.ts (fetch +
// getValidAccessToken depuis @/lib/google-auth, pas de SDK googleapis).

import { getValidAccessToken } from '@/lib/google-auth';
import {
  createInterventionFolder as createInterventionFolderHierarchical,
  ensureFolder,
} from '@/lib/google-drive';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

// ─── Types exportés ────────────────────────────────────────────────────

export interface NextRefResult {
  ref: string;     // ex: "2026-148"
  number: number;  // ex: 148
}

export interface CreateInterventionFolderFromMailResult {
  folder_id: string;
  folder_name: string;
  ref: string;
  number: number;
  year: number;
  url: string;
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

function getRapportsRootId(): string {
  const id = process.env.GOOGLE_DRIVE_RAPPORTS_FOLDER_ID;
  if (!id || !id.trim()) {
    throw new Error('Drive: GOOGLE_DRIVE_RAPPORTS_FOLDER_ID manquante (cf. .env.example).');
  }
  return id.trim();
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

// Alloue la prochaine référence "AAAA-NNN" pour une année donnée.
// Scanne RAPPORTS/{year}/ (créé à la volée si absent) et parse les
// noms de sous-dossiers '{year}-NNN ' pour trouver le numéro max.
// Démarre à 1 si le dossier année est vide ou si aucun nom matche.
//
// ⚠ Concurrence : la lecture-puis-allocation n'est pas atomique côté
// Drive. Si 2 mails sont traités en parallèle, ils peuvent se voir
// attribuer la même ref. Acceptable pour le débit actuel (cron toutes
// les N minutes) ; à sérialiser via un lock applicatif si on monte en
// charge sur du temps réel.
export async function generateNextRef(
  year: number = new Date().getFullYear(),
): Promise<NextRefResult> {
  try {
    const [rootId, token] = await Promise.all([
      Promise.resolve(getRapportsRootId()),
      getAccessToken(),
    ]);

    const yearFolder = await ensureFolder(token, rootId, String(year));
    if (!yearFolder) {
      throw new Error(`Drive: échec création/accès dossier année ${year}.`);
    }

    const children = await listChildFolders(token, yearFolder.id);
    const refRegex = new RegExp(`^${year}-(\\d{3,})\\s`);
    let max = 0;
    for (const f of children) {
      const m = refRegex.exec(f.name);
      if (!m) continue;
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }

    const number = max + 1;
    const ref = `${year}-${String(number).padStart(3, '0')}`;
    return { ref, number };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'erreur inconnue';
    console.error('[drive/create-intervention-folder] generateNextRef failed:', msg);
    if (e instanceof Error && e.message.startsWith('Drive:')) throw e;
    throw new Error(`Drive: impossible d'allouer la référence — ${msg}`);
  }
}

// Wrapper one-shot pour le pipeline mail entrant : alloue une ref via
// generateNextRef puis crée le dossier d'intervention via la fonction
// hiérarchique de @/lib/google-drive (qui gère ensureFolder year +
// dossier intervention + sous-dossier photos/).
//
// Le folder_name est reconstruit côté wrapper pour le retourner — la
// fonction sous-jacente applique le même format
// `${ref} ${adresse}`.trim().slice(0, 200) en interne.
export async function createInterventionFolderFromMail(
  adresse: string,
): Promise<CreateInterventionFolderFromMailResult> {
  try {
    const cleanedAdresse = adresse.trim().replace(/\s+/g, ' ');
    if (!cleanedAdresse) {
      throw new Error('Drive: adresse vide — impossible de nommer le dossier.');
    }
    const year = new Date().getFullYear();
    const { ref, number } = await generateNextRef(year);

    const result = await createInterventionFolderHierarchical({ ref, adresse: cleanedAdresse, year });
    if (!result.ok) {
      throw new Error(`Drive: création dossier intervention — ${result.error}`);
    }

    // Reproduit la troncature appliquée par createInterventionFolder
    // (cf. google-drive.ts:207) — garantit que le folder_name retourné
    // matche exactement ce qui a été créé sur Drive.
    const folder_name = `${ref} ${cleanedAdresse}`.trim().slice(0, 200);

    return {
      folder_id: result.folder_id,
      folder_name,
      ref,
      number,
      year,
      url: result.web_view_link,
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
