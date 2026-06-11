// Config des dossiers racine Google Drive — source unique des lectures
// GOOGLE_DRIVE_RAPPORTS_FOLDER_ID / GOOGLE_DRIVE_FACTURES_FOLDER_ID
// (audit qualité 2026-06-11, H1 : auparavant relues en dur dans 8+ points,
// chacune avec son propre guard).
//
// Deux accesseurs, mémoïsés au niveau module :
//   - getDriveFolders()     : strict — throw une Error explicite nommant la
//                             (les) variable(s) manquante(s). Pour les chemins
//                             où l'absence de config doit interrompre.
//   - getDriveFoldersSafe() : nullable — ne throw jamais. Pour les chemins
//                             best-effort qui dégradent gracieusement
//                             (return null / { ok: false }) : ne pas
//                             transformer un best-effort en crash.

export type DriveFolders = {
  rapportsFolderId: string;
  facturesFolderId: string;
};

export type DriveFoldersSafe = {
  rapportsFolderId: string | null;
  facturesFolderId: string | null;
};

let cached: DriveFoldersSafe | null = null;

export function getDriveFoldersSafe(): DriveFoldersSafe {
  if (!cached) {
    cached = {
      rapportsFolderId: process.env.GOOGLE_DRIVE_RAPPORTS_FOLDER_ID?.trim() || null,
      facturesFolderId: process.env.GOOGLE_DRIVE_FACTURES_FOLDER_ID?.trim() || null,
    };
  }
  return cached;
}

export function getDriveFolders(): DriveFolders {
  const { rapportsFolderId, facturesFolderId } = getDriveFoldersSafe();
  const missing: string[] = [];
  if (!rapportsFolderId) missing.push('GOOGLE_DRIVE_RAPPORTS_FOLDER_ID');
  if (!facturesFolderId) missing.push('GOOGLE_DRIVE_FACTURES_FOLDER_ID');
  if (missing.length > 0) {
    throw new Error(
      `Drive: variable(s) d'environnement manquante(s) : ${missing.join(', ')} (cf. .env.example).`,
    );
  }
  return { rapportsFolderId: rapportsFolderId!, facturesFolderId: facturesFolderId! };
}
