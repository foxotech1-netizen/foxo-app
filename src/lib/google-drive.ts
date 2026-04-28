// Google Drive — synchronisation des photos et rapports d'intervention.
//
// Structure cible :
//   FoxO/
//     Interventions/
//       2026/
//         [ref — adresse]/
//           photos/
//             IMG_001.jpg
//             …
//           rapport.pdf
//
// Branchement futur :
//   - Variable d'env : GOOGLE_SERVICE_ACCOUNT_JSON (mêmes credentials que Calendar)
//   - Optionnel : GOOGLE_DRIVE_ROOT_FOLDER_ID (dossier parent partagé avec le compte de service)
//
// Tant que les credentials ne sont pas configurés, les fonctions retournent
// `{ ok: false, error: 'Google Drive non configuré' }`.

export type DriveFolderResult =
  | { ok: true; folder_id: string; web_view_link: string }
  | { ok: false; error: string };

export type DriveUploadResult =
  | { ok: true; file_id: string; web_view_link: string }
  | { ok: false; error: string };

function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

// TODO : crée le dossier "2026-XXX — Adresse" dans Drive sous l'année courante.
// Si le dossier existe déjà (par ref), retourne son id. Stocker l'id dans
// la colonne `interventions.drive_folder_id` (à ajouter).
export async function createInterventionFolder(_args: {
  ref: string;            // ex : "2026-014"
  adresse: string;        // ex : "Avenue Louise 42, 1050 Bruxelles"
  year: number;           // ex : 2026
}): Promise<DriveFolderResult> {
  if (!googleConfigured()) {
    return { ok: false, error: 'Google Drive non configuré (GOOGLE_SERVICE_ACCOUNT_JSON manquant).' };
  }
  // Implémentation future : googleapis.drive.files.create (mimeType folder).
  return { ok: false, error: 'Non implémenté.' };
}

// TODO : upload une photo prise sur mobile vers Drive/{folder}/photos/.
// `bytes` = contenu binaire (Buffer ou Uint8Array).
export async function uploadPhotoToDrive(_args: {
  folderId: string;
  filename: string;
  bytes: ArrayBuffer | Uint8Array;
  mimeType?: string;
}): Promise<DriveUploadResult> {
  if (!googleConfigured()) {
    return { ok: false, error: 'Google Drive non configuré.' };
  }
  // Implémentation future : googleapis.drive.files.create avec parent = sub-folder photos/.
  return { ok: false, error: 'Non implémenté.' };
}

// TODO : upload le rapport PDF généré (depuis /api/rapport/[id]) vers Drive/{folder}/rapport.pdf.
// Si un rapport.pdf existe déjà, écraser (publication d'une version à jour).
export async function uploadRapportToDrive(_args: {
  folderId: string;
  bytes: ArrayBuffer | Uint8Array;
  filename?: string;      // défaut "rapport.pdf"
}): Promise<DriveUploadResult> {
  if (!googleConfigured()) {
    return { ok: false, error: 'Google Drive non configuré.' };
  }
  // Implémentation future : googleapis.drive.files.create / .update.
  return { ok: false, error: 'Non implémenté.' };
}
