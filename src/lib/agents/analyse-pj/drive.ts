/**
 * src/lib/agents/analyse-pj/drive.ts
 *
 * Intégration Drive pour Agent 2. Deux responsabilités :
 *   1. resolveInterventionDriveFolderId : lit interventions.drive_folder_id
 *      pour un intervention_id donné.
 *   2. uploadAttachmentAndUpdate : upload Drive via la fonction existante
 *      uploadAttachmentToFolder, puis UPDATE la row `attachments` avec
 *      drive_url + drive_file_id.
 *
 * Pas de création de dossier Drive ici — c est la responsabilité du
 * pipeline mail en amont (confirm-and-create). Agent 2 reste passif.
 */

import type { createAdminClient } from '@/lib/supabase/admin';
import { uploadAttachmentToFolder } from '@/lib/drive/create-intervention-folder';

type AdminDb = ReturnType<typeof createAdminClient>;

export async function resolveInterventionDriveFolderId(
  supabase: AdminDb,
  interventionId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('interventions')
    .select('drive_folder_id')
    .eq('id', interventionId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { drive_folder_id: string | null };
  return row.drive_folder_id ?? null;
}

export async function uploadAttachmentAndUpdate(args: {
  supabase: AdminDb;
  attachmentId: string;
  folderId: string;
  filename: string;
  mimeType: string;
  contentBase64: string;
}): Promise<{ drive_url: string; drive_file_id: string }> {
  const { supabase, attachmentId, folderId, filename, mimeType, contentBase64 } = args;

  const result = await uploadAttachmentToFolder({
    folder_id: folderId,
    filename,
    mime_type: mimeType,
    data_base64: contentBase64,
  });

  const { error } = await supabase
    .from('attachments')
    .update({
      drive_url: result.url,
      drive_file_id: result.file_id,
    })
    .eq('id', attachmentId);

  if (error) {
    throw new Error('attachments update drive cols: ' + error.message);
  }

  return { drive_url: result.url, drive_file_id: result.file_id };
}
