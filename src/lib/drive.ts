// Stub Google Drive sync.
// Tant que `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` (clé privée d'un compte de service)
// n'est pas configurée, l'appel échoue avec un message clair. Quand tu fournis
// la clé, on passe à l'implémentation réelle (paquet `googleapis`, scope
// drive.file, dossier dédié par intervention, partage avec adresse FoxO).

export type DriveSyncResult =
  | { ok: true; folderUrl: string; uploaded: number }
  | { ok: false; error: string };

export async function syncInterventionToDrive(
  _interventionId: string,
): Promise<DriveSyncResult> {
  const json = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
  if (!json) {
    return {
      ok: false,
      error: 'Sync Google Drive non configurée. Renseigne GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON dans .env.local et installe googleapis.',
    };
  }
  // TODO : implémentation réelle quand credentials disponibles.
  return { ok: false, error: 'Implémentation à finaliser une fois les credentials fournies.' };
}
