import { NextResponse } from 'next/server';
import { listFolderFiles } from '@/lib/google-drive';
import { guardDocumentsAccess, resolveInterventionFolder } from './resolve-folder';

// Liste des documents Drive du dossier d'une intervention (portail tech,
// Mails V2 P2 U4). Lecture seule. Garde : tech assigné OU admin.
// Ne renvoie JAMAIS webViewLink — le tech n'a pas accès au Drive société,
// tout passe par la route proxy [fileId].

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const guard = await guardDocumentsAccess(id);
  if (!guard.ok) {
    return NextResponse.json({ ok: false, error: guard.message }, { status: guard.status });
  }

  const folder = await resolveInterventionFolder(id);
  if (!folder.ok) {
    return NextResponse.json({ ok: false, error: folder.error }, { status: 404 });
  }
  // Dossier pas encore créé : état normal, pas une erreur.
  if (!folder.folderId) {
    return NextResponse.json({ ok: true, files: [], folderMissing: true });
  }

  const list = await listFolderFiles(folder.folderId);
  if (!list.ok) {
    return NextResponse.json({ ok: false, error: list.error }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    folderId: folder.folderId,
    files: list.files
      .filter((f) => !f.isFolder)
      .map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size,
        modifiedTime: f.modifiedTime,
      })),
  });
}
