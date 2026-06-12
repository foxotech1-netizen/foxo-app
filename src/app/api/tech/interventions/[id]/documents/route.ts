import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getCurrentTech, verifyTechOwnsIntervention, techError } from '@/lib/auth/tech-helpers';
import { listFolderFiles, resolveInterventionFolderByName } from '@/lib/google-drive';

export const dynamic = 'force-dynamic';

// Listing des documents du dossier Drive d'une intervention (Mails V2 P2 —
// U4, panneau Documents du portail technicien). Lecture seule.
//
// Sécurité : tech connecté + ownership intervention (technicien_id), même
// garde que upload-photo. Les sous-dossiers (ex : photos/) sont exclus —
// les photos ont déjà leur panneau dédié.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const tech = await getCurrentTech(supabase);
  if (!tech.ok) return techError(tech);

  const { id } = await params;
  const owns = await verifyTechOwnsIntervention(supabase, tech.tech.id, id, {
    select: 'id, ref, drive_folder_id',
    splitNotFound: true,
  });
  if (!owns.ok) return techError(owns);

  const iv = owns.intervention as { id: string; ref: string | null; drive_folder_id: string | null };

  // L'ID de dossier Drive n'est pas toujours persisté en base : les uploads
  // (rapport, photos) retrouvent le dossier par son NOM. Si l'ID stocké est
  // absent, on résout le dossier de la même façon (lecture seule, sans créer).
  let folderId = iv.drive_folder_id;
  if (!folderId && iv.ref) {
    const yr = Number(iv.ref.slice(0, 4)) || new Date().getFullYear();
    folderId = await resolveInterventionFolderByName(iv.ref, yr);
  }
  // Pas de dossier Drive → état « vide » côté UI, pas une erreur.
  if (!folderId) {
    return NextResponse.json({ ok: true, folderId: null, files: [] });
  }

  const res = await listFolderFiles(folderId);
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: `Impossible de lister les documents du dossier : ${res.error}` },
      { status: 502 },
    );
  }

  const files = res.files
    .filter((f) => !f.isFolder)
    .map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: f.size,
      modifiedTime: f.modifiedTime,
      webViewLink: f.webViewLink,
    }));

  return NextResponse.json({ ok: true, folderId, files });
}
