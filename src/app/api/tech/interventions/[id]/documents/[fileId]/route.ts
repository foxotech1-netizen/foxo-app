import { NextResponse } from 'next/server';
import { getDriveFileMeta, downloadDriveFile } from '@/lib/google-drive';
import { sanitizeFilename, sanitizeMime, buildSafeFileHeaders } from '@/lib/http/safe-file-response';
import { guardDocumentsAccess, resolveInterventionFolder } from '../resolve-folder';

// Proxy de téléchargement/aperçu d'un document Drive du dossier d'une
// intervention (portail tech, Mails V2 P2 U4). Garde : tech assigné OU
// admin, PUIS vérification de parenté (meta.parents doit contenir le
// dossier de l'intervention) — garde anti-énumération : la RLS ne
// protège pas Drive, un fileId deviné ne doit rien servir.
// En-têtes sûrs partagés avec la route PJ Gmail (SVG jamais inline,
// nosniff, CSP sandbox, RFC 5987, cache privé 5 min).

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Plafond de réponse des fonctions Vercel ~4,5 MB.
const MAX_DOCUMENT_DOWNLOAD_BYTES = 4 * 1024 * 1024;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const { id, fileId } = await params;

  const guard = await guardDocumentsAccess(id);
  if (!guard.ok) {
    return NextResponse.json({ ok: false, error: guard.message }, { status: guard.status });
  }

  const folder = await resolveInterventionFolder(id);
  if (!folder.ok || !folder.folderId) {
    return NextResponse.json(
      { ok: false, error: 'Dossier Drive de l\'intervention introuvable.' },
      { status: 404 },
    );
  }

  const meta = await getDriveFileMeta(fileId);
  if (!meta.ok) {
    return NextResponse.json({ ok: false, error: 'Fichier introuvable.' }, { status: 404 });
  }
  if (!meta.parents.includes(folder.folderId)) {
    return NextResponse.json(
      { ok: false, error: 'Fichier hors du dossier de l\'intervention.' },
      { status: 403 },
    );
  }

  const dl = await downloadDriveFile(fileId, MAX_DOCUMENT_DOWNLOAD_BYTES);
  if (!dl.ok) {
    if (dl.tooLarge) {
      return NextResponse.json(
        { ok: false, error: 'Fichier trop volumineux pour l\'aperçu mobile.' },
        { status: 413 },
      );
    }
    return NextResponse.json({ ok: false, error: dl.error }, { status: 502 });
  }

  const filename = sanitizeFilename(meta.name);
  const mime = sanitizeMime(meta.mimeType);
  return new NextResponse(new Uint8Array(dl.data), {
    headers: buildSafeFileHeaders({ filename, mime, byteLength: dl.data.byteLength }),
  });
}
