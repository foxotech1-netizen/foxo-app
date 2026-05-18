/**
 * src/lib/agents/analyse-pj/index.ts
 *
 * Entry point Agent 2. Orchestre filter → analyze-one (LLM) → persist row
 * `attachments` → upload Drive + UPDATE row si possible.
 *
 * Drive est best-effort : si l intervention n a pas de drive_folder_id
 * ou si l upload échoue, la row attachments existe quand même avec
 * drive_url=null et drive_error renseigné (si échec) ou null (si pas
 * tenté). L analyse LLM, elle, a réussi — donc la PJ reste dans
 * attachments_processed[].
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { classifyAttachment } from './filter';
import { analyzeOneAttachment } from './analyze-one';
import { buildNewFilename, folderFor } from './rename';
import {
  resolveInterventionDriveFolderId,
  uploadAttachmentAndUpdate,
} from './drive';
import type {
  AnalyseInput,
  AnalyseOutput,
  AnalysedAttachment,
  AttachmentError,
  SkippedAttachment,
} from './types';

export type { AnalyseInput, AnalyseOutput, AttachmentInput } from './types';

export async function analyseAttachments(input: AnalyseInput): Promise<AnalyseOutput> {
  const supabase = createAdminClient();
  const processed: AnalysedAttachment[] = [];
  const skipped: SkippedAttachment[] = [];
  const errors: AttachmentError[] = [];

  // Résolution one-shot du dossier Drive (si intervention_id fourni).
  // null = pas d upload tenté pour ce batch.
  const driveFolderId =
    input.context.intervention_id
      ? await resolveInterventionDriveFolderId(supabase, input.context.intervention_id)
      : null;

  for (const att of input.attachments) {
    const decision = classifyAttachment(att);
    if (!decision.keep) {
      skipped.push(decision.skipped);
      continue;
    }

    // ── Branche office_v0_skip : pas d analyse LLM, mais on archive Drive
    if (decision.mime_class === 'office_v0_skip') {
      const { data, error } = await supabase
        .from('attachments')
        .insert({
          intervention_id: input.context.intervention_id ?? null,
          email_id: input.context.email_id ?? null,
          original_filename: att.filename,
          mime_type: att.mime_type,
          size_bytes: att.size_bytes,
          type_detecte: null,
          target_folder: null,
          extracted_data: {},
          content_summary: 'Format non analysé en V0 (Word/Excel/autre).',
        })
        .select('id')
        .single();

      if (error || !data) {
        errors.push({
          original_filename: att.filename,
          error_message: error?.message ?? 'insert attachments échoué (office_v0_skip)',
        });
        continue;
      }

      // Upload Drive best-effort avec original_filename.
      let drive_url: string | null = null;
      let drive_file_id: string | null = null;
      let drive_error: string | null = null;
      if (driveFolderId) {
        try {
          const up = await uploadAttachmentAndUpdate({
            supabase,
            attachmentId: data.id,
            folderId: driveFolderId,
            filename: att.filename,
            mimeType: att.mime_type,
            contentBase64: att.content_base64,
          });
          drive_url = up.drive_url;
          drive_file_id = up.drive_file_id;
        } catch (e) {
          drive_error = e instanceof Error ? e.message : String(e);
        }
      }

      processed.push({
        attachment_id: data.id,
        original_filename: att.filename,
        detected_type: null,
        new_filename: null,
        extracted_data: {},
        target_folder: null,
        confidence: null,
        content_summary: 'Format non analysé en V0 (Word/Excel/autre).',
        drive_url,
        drive_file_id,
        drive_error,
      });
      continue;
    }

    // ── Branche PDF/image : analyse LLM puis insert + Drive
    try {
      const { output } = await analyzeOneAttachment({
        attachment: att,
        mimeClass: decision.mime_class,
        context: input.context,
      });

      const dateDoc =
        typeof output.extracted_data?.date_document === 'string'
          ? (output.extracted_data.date_document as string)
          : null;

      const newFilename = buildNewFilename({
        ref_foxo: input.context.ref_foxo ?? null,
        detected_type: output.detected_type,
        date_document: dateDoc,
        original_filename: att.filename,
      });
      const targetFolder = folderFor(output.detected_type);

      const { data, error } = await supabase
        .from('attachments')
        .insert({
          intervention_id: input.context.intervention_id ?? null,
          email_id: input.context.email_id ?? null,
          original_filename: att.filename,
          new_filename: newFilename,
          mime_type: att.mime_type,
          size_bytes: att.size_bytes,
          type_detecte: output.detected_type,
          target_folder: targetFolder,
          extracted_data: output.extracted_data ?? {},
          content_summary: output.content_summary ?? null,
        })
        .select('id')
        .single();

      if (error || !data) {
        errors.push({
          original_filename: att.filename,
          error_message: error?.message ?? 'insert attachments échoué',
        });
        continue;
      }

      // Upload Drive best-effort avec new_filename.
      let drive_url: string | null = null;
      let drive_file_id: string | null = null;
      let drive_error: string | null = null;
      if (driveFolderId) {
        try {
          const up = await uploadAttachmentAndUpdate({
            supabase,
            attachmentId: data.id,
            folderId: driveFolderId,
            filename: newFilename,
            mimeType: att.mime_type,
            contentBase64: att.content_base64,
          });
          drive_url = up.drive_url;
          drive_file_id = up.drive_file_id;
        } catch (e) {
          drive_error = e instanceof Error ? e.message : String(e);
        }
      }

      processed.push({
        attachment_id: data.id,
        original_filename: att.filename,
        detected_type: output.detected_type,
        new_filename: newFilename,
        extracted_data: output.extracted_data ?? {},
        target_folder: targetFolder,
        confidence: output.confidence,
        content_summary: output.content_summary ?? null,
        drive_url,
        drive_file_id,
        drive_error,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ original_filename: att.filename, error_message: msg });
    }
  }

  return { attachments_processed: processed, skipped, errors };
}
