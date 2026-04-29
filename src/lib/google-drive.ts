// Google Drive — implémentation REST via fetch().
//
// Variables d'env :
//   - GOOGLE_DRIVE_RAPPORTS_FOLDER_ID (dossier racine RAPPORTS partagé avec
//     le compte OAuth FoxO)
//   - GOOGLE_DRIVE_FACTURES_FOLDER_ID (dossier racine FACTURES)
//
// Structure créée automatiquement à la volée :
//   RAPPORTS/[YYYY]/[ref + adresse]/
//     photos/
//     rapport.pdf
//   FACTURES/[YYYY]/[T1-T4 trimestre]/[mois]/
//     [numero].pdf
//
// Si Google n'est pas connecté ou non configuré, les fonctions retournent
// `{ ok: false, error }` sans planter (best-effort).

import { getValidAccessToken } from '@/lib/google-auth';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

const MOIS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

function trimestreLabel(month0: number): string {
  if (month0 <= 2)  return 'T1 - Janvier-Mars';
  if (month0 <= 5)  return 'T2 - Avril-Juin';
  if (month0 <= 8)  return 'T3 - Juillet-Septembre';
  return 'T4 - Octobre-Décembre';
}

function escapeQuery(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export type DriveFolderResult =
  | { ok: true; folder_id: string; web_view_link: string }
  | { ok: false; error: string };

export type DriveUploadResult =
  | { ok: true; file_id: string; web_view_link: string }
  | { ok: false; error: string };

interface DriveFile {
  id: string;
  name: string;
  webViewLink?: string;
}

// Recherche un sous-dossier par nom dans un parent. Retourne null si absent.
async function findChildFolder(token: string, parentId: string, name: string): Promise<DriveFile | null> {
  const q = `'${parentId}' in parents and name='${escapeQuery(name)}' and mimeType='${FOLDER_MIME}' and trashed=false`;
  const url = `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,webViewLink)&pageSize=1`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const j = (await res.json()) as { files?: DriveFile[] };
  return j.files?.[0] ?? null;
}

async function createFolder(token: string, parentId: string, name: string): Promise<DriveFile | null> {
  const res = await fetch(`${DRIVE_API}/files?fields=id,name,webViewLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  if (!res.ok) return null;
  return (await res.json()) as DriveFile;
}

async function ensureFolder(token: string, parentId: string, name: string): Promise<DriveFile | null> {
  const existing = await findChildFolder(token, parentId, name);
  if (existing) return existing;
  return createFolder(token, parentId, name);
}

// Upload multipart : metadata + bytes en un seul POST.
async function uploadMultipart(
  token: string,
  parentId: string,
  filename: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<DriveFile | null> {
  const boundary = '----foxo' + Math.random().toString(36).slice(2);
  const metadata = JSON.stringify({ name: filename, parents: [parentId] });
  const pre = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const post = `\r\n--${boundary}--`;

  const preBuf = new TextEncoder().encode(pre);
  const postBuf = new TextEncoder().encode(post);
  const body = new Uint8Array(preBuf.length + bytes.length + postBuf.length);
  body.set(preBuf, 0);
  body.set(bytes, preBuf.length);
  body.set(postBuf, preBuf.length + bytes.length);

  const res = await fetch(`${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,webViewLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) return null;
  return (await res.json()) as DriveFile;
}

// Cherche un fichier (non-folder) par nom dans un parent
async function findChildFile(token: string, parentId: string, name: string): Promise<DriveFile | null> {
  const q = `'${parentId}' in parents and name='${escapeQuery(name)}' and trashed=false and mimeType!='${FOLDER_MIME}'`;
  const url = `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,webViewLink)&pageSize=1`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const j = (await res.json()) as { files?: DriveFile[] };
  return j.files?.[0] ?? null;
}

async function updateFileContent(token: string, fileId: string, bytes: Uint8Array, mimeType: string): Promise<DriveFile | null> {
  const res = await fetch(`${DRIVE_UPLOAD}/files/${fileId}?uploadType=media&fields=id,name,webViewLink`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': mimeType },
    body: bytes as unknown as BodyInit,
  });
  if (!res.ok) return null;
  return (await res.json()) as DriveFile;
}

// Vérifie qu'un dossier Drive existe et n'est pas dans la corbeille.
// Retourne { ok, name?, status?, error?, trashed? }.
export interface VerifyFolderResult {
  ok: boolean;
  name?: string;
  status?: number;
  error?: string;
  trashed?: boolean;
}

export async function verifyDriveFolder(folderId: string): Promise<VerifyFolderResult> {
  if (!folderId) {
    return { ok: false, error: 'ID dossier vide.' };
  }
  const auth = await getValidAccessToken();
  if (!auth) {
    return { ok: false, error: 'Google non connecté.' };
  }
  const url = `${DRIVE_API}/files/${folderId}?fields=id,name,trashed,mimeType`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${auth.access_token}` } });
  if (res.status === 404) {
    console.error('[drive] dossier introuvable (404)', folderId);
    return { ok: false, status: 404, error: `Dossier Drive introuvable — vérifiez l'ID ${folderId}` };
  }
  if (res.status === 403) {
    const txt = await res.text();
    console.error('[drive] accès refusé (403)', folderId, txt.slice(0, 200));
    return { ok: false, status: 403, error: `Accès refusé au dossier ${folderId}. Le compte connecté doit avoir le partage.` };
  }
  if (!res.ok) {
    const txt = await res.text();
    console.error('[drive] HTTP', res.status, folderId, txt.slice(0, 200));
    return { ok: false, status: res.status, error: `Drive HTTP ${res.status} : ${txt.slice(0, 200)}` };
  }
  const data = (await res.json()) as { id: string; name: string; trashed: boolean; mimeType: string };
  if (data.trashed) {
    console.error('[drive] dossier dans la corbeille', folderId, data.name);
    return { ok: false, name: data.name, trashed: true, error: `Le dossier "${data.name}" est dans la corbeille.` };
  }
  if (data.mimeType !== FOLDER_MIME) {
    return { ok: false, name: data.name, error: `L'ID ${folderId} pointe sur un fichier, pas un dossier.` };
  }
  return { ok: true, name: data.name };
}

// ─── API publique ────────────────────────────────────────────────────────

// Crée (ou récupère) le dossier "RAPPORTS/{year}/{ref + adresse}/" + le
// sous-dossier photos/. Renvoie l'id du dossier intervention.
export async function createInterventionFolder(args: {
  ref: string;
  adresse: string;
  year: number;
}): Promise<DriveFolderResult> {
  const root = process.env.GOOGLE_DRIVE_RAPPORTS_FOLDER_ID;
  if (!root) return { ok: false, error: 'GOOGLE_DRIVE_RAPPORTS_FOLDER_ID manquant.' };
  const auth = await getValidAccessToken();
  if (!auth) return { ok: false, error: 'Google non connecté (voir /admin/parametres).' };

  // Vérifie le dossier racine avant tout — évite des appels en cascade
  // si l'ID env est devenu invalide.
  const verify = await verifyDriveFolder(root);
  if (!verify.ok) {
    return { ok: false, error: verify.error ?? 'Dossier RAPPORTS inaccessible.' };
  }

  const yearFolder = await ensureFolder(auth.access_token, root, String(args.year));
  if (!yearFolder) return { ok: false, error: 'Échec création dossier année.' };

  const dossierName = `${args.ref} ${args.adresse}`.trim().slice(0, 200);
  const ivFolder = await ensureFolder(auth.access_token, yearFolder.id, dossierName);
  if (!ivFolder) return { ok: false, error: 'Échec création dossier intervention.' };

  // Sous-dossier photos/
  await ensureFolder(auth.access_token, ivFolder.id, 'photos');

  return {
    ok: true,
    folder_id: ivFolder.id,
    web_view_link: ivFolder.webViewLink ?? `https://drive.google.com/drive/folders/${ivFolder.id}`,
  };
}

// Localise (ou crée) le dossier intervention puis le sous-dossier photos.
async function getPhotosFolder(token: string, ref: string, adresse: string, year: number): Promise<string | null> {
  const root = process.env.GOOGLE_DRIVE_RAPPORTS_FOLDER_ID;
  if (!root) return null;
  const yearF = await ensureFolder(token, root, String(year));
  if (!yearF) return null;
  const dossierName = `${ref} ${adresse}`.trim().slice(0, 200);
  const ivF = await ensureFolder(token, yearF.id, dossierName);
  if (!ivF) return null;
  const photosF = await ensureFolder(token, ivF.id, 'photos');
  return photosF?.id ?? null;
}

export async function uploadPhoto(args: {
  ref: string;
  adresse: string;
  year: number;
  filename: string;
  bytes: Uint8Array;
  mimeType?: string;
}): Promise<DriveUploadResult> {
  const auth = await getValidAccessToken();
  if (!auth) return { ok: false, error: 'Google non connecté.' };
  const root = process.env.GOOGLE_DRIVE_RAPPORTS_FOLDER_ID;
  if (!root) return { ok: false, error: 'GOOGLE_DRIVE_RAPPORTS_FOLDER_ID manquant.' };
  const verify = await verifyDriveFolder(root);
  if (!verify.ok) return { ok: false, error: verify.error ?? 'Dossier RAPPORTS inaccessible.' };
  const folderId = await getPhotosFolder(auth.access_token, args.ref, args.adresse, args.year);
  if (!folderId) return { ok: false, error: 'Dossier photos introuvable.' };
  const f = await uploadMultipart(auth.access_token, folderId, args.filename, args.bytes, args.mimeType ?? 'image/jpeg');
  if (!f) return { ok: false, error: 'Échec upload photo.' };
  return { ok: true, file_id: f.id, web_view_link: f.webViewLink ?? '' };
}

export async function uploadRapport(args: {
  ref: string;
  adresse: string;
  year: number;
  bytes: Uint8Array;
  filename?: string;
}): Promise<DriveUploadResult> {
  const auth = await getValidAccessToken();
  if (!auth) return { ok: false, error: 'Google non connecté.' };
  const root = process.env.GOOGLE_DRIVE_RAPPORTS_FOLDER_ID;
  if (!root) return { ok: false, error: 'GOOGLE_DRIVE_RAPPORTS_FOLDER_ID manquant.' };
  const verify = await verifyDriveFolder(root);
  if (!verify.ok) return { ok: false, error: verify.error ?? 'Dossier RAPPORTS inaccessible.' };
  const yearF = await ensureFolder(auth.access_token, root, String(args.year));
  if (!yearF) return { ok: false, error: 'Dossier année introuvable.' };
  const dossierName = `${args.ref} ${args.adresse}`.trim().slice(0, 200);
  const ivF = await ensureFolder(auth.access_token, yearF.id, dossierName);
  if (!ivF) return { ok: false, error: 'Dossier intervention introuvable.' };

  const filename = args.filename ?? 'rapport.pdf';
  // Si le fichier existe déjà, on update son contenu (versioning souple)
  const existing = await findChildFile(auth.access_token, ivF.id, filename);
  const f = existing
    ? await updateFileContent(auth.access_token, existing.id, args.bytes, 'application/pdf')
    : await uploadMultipart(auth.access_token, ivF.id, filename, args.bytes, 'application/pdf');
  if (!f) return { ok: false, error: 'Échec upload rapport.' };
  return { ok: true, file_id: f.id, web_view_link: f.webViewLink ?? '' };
}

export async function uploadFacture(args: {
  numero: string;
  date: Date;
  bytes: Uint8Array;
}): Promise<DriveUploadResult> {
  const root = process.env.GOOGLE_DRIVE_FACTURES_FOLDER_ID;
  if (!root) return { ok: false, error: 'GOOGLE_DRIVE_FACTURES_FOLDER_ID manquant.' };
  const auth = await getValidAccessToken();
  if (!auth) return { ok: false, error: 'Google non connecté.' };
  const verify = await verifyDriveFolder(root);
  if (!verify.ok) return { ok: false, error: verify.error ?? 'Dossier FACTURES inaccessible.' };

  const year = args.date.getFullYear();
  const month0 = args.date.getMonth();
  const trimestre = trimestreLabel(month0);
  const moisName = MOIS_FR[month0];

  const yearF = await ensureFolder(auth.access_token, root, String(year));
  if (!yearF) return { ok: false, error: 'Dossier année introuvable.' };
  const trimF = await ensureFolder(auth.access_token, yearF.id, trimestre);
  if (!trimF) return { ok: false, error: 'Dossier trimestre introuvable.' };
  const moisF = await ensureFolder(auth.access_token, trimF.id, moisName);
  if (!moisF) return { ok: false, error: 'Dossier mois introuvable.' };

  const filename = `${args.numero}.pdf`;
  const existing = await findChildFile(auth.access_token, moisF.id, filename);
  const f = existing
    ? await updateFileContent(auth.access_token, existing.id, args.bytes, 'application/pdf')
    : await uploadMultipart(auth.access_token, moisF.id, filename, args.bytes, 'application/pdf');
  if (!f) return { ok: false, error: 'Échec upload facture.' };
  return { ok: true, file_id: f.id, web_view_link: f.webViewLink ?? '' };
}

// Retour granulaire : statut par dossier (rapports + factures) avec
// nom du dossier si accessible, ou erreur explicite (404 / 403 / autre).
export interface TestDriveResult {
  rapports: VerifyFolderResult & { id: string | null };
  factures: VerifyFolderResult & { id: string | null };
}

export async function testDriveConnection(): Promise<TestDriveResult> {
  const rRapports = process.env.GOOGLE_DRIVE_RAPPORTS_FOLDER_ID ?? '';
  const rFactures = process.env.GOOGLE_DRIVE_FACTURES_FOLDER_ID ?? '';

  const auth = await getValidAccessToken();
  if (!auth) {
    const err: VerifyFolderResult = { ok: false, error: 'Google non connecté.' };
    return {
      rapports: { ...err, id: rRapports || null },
      factures: { ...err, id: rFactures || null },
    };
  }

  // Vérifie en parallèle les deux racines
  const [rapports, factures] = await Promise.all([
    rRapports
      ? verifyDriveFolder(rRapports)
      : Promise.resolve<VerifyFolderResult>({ ok: false, error: 'GOOGLE_DRIVE_RAPPORTS_FOLDER_ID manquant.' }),
    rFactures
      ? verifyDriveFolder(rFactures)
      : Promise.resolve<VerifyFolderResult>({ ok: false, error: 'GOOGLE_DRIVE_FACTURES_FOLDER_ID manquant.' }),
  ]);

  return {
    rapports: { ...rapports, id: rRapports || null },
    factures: { ...factures, id: rFactures || null },
  };
}
