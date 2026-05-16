/**
 * src/lib/agents/analyse-pj/index.ts
 *
 * Entry point Agent 2. Orchestre filter → analyze-one (LLM) → persist (table
 * `attachments`). Pas de Drive dans cette étape — drive_url/drive_file_id
 * restent null et seront remplis à l'étape suivante.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { classifyAttachment } from './filter';
import { analyzeOneAttachment } from './analyze-one';
import { buildNewFilename, folderFor } from './rename';
import type {
  AnalyseInput,
  AnalyseOutput,
  AnalysedAttachment,
  AttachmentError,
  SkippedAttachment,
} from './types';

export type { AnalyseInput, AnalyseOutput } from './types';

export async function analyseAttachments(input: AnalyseInput): Promise<AnalyseOutput> {
  const supabase = createAdminClient();
  const processed: AnalysedAttachment[] = [];
  const skipped: SkippedAttachment[] = [];
  const errors: AttachmentError[] = [];

  for (const att of input.attachments) {
    const decision = classifyAttachment(att);
    if (!decision.keep) {
      skipped.push(decision.skipped);
      continue;
    }

    // Cas office_v0_skip : on insère une row sans analyse LLM.
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

      if (error) {
        errors.push({ original_filename: att.filename, error_message: error.message });
        continue;
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
      });
      continue;
    }

    // Cas PDF / image : appel LLM via runAgent
    try {
      const { output } = await analyzeOneAttachment({
        attachment: att,
        mimeClass: decision.mime_class,
        context: input.context,
      });

      const newFilename = buildNewFilename({
        ref_foxo: input.context.ref_foxo ?? null,
        detected_type: output.detected_type,
        date_document:
          typeof output.extracted_data?.date_document === 'string'
            ? (output.extracted_data.date_document as string)
            : null,
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

      if (error) {
        errors.push({ original_filename: att.filename, error_message: error.message });
        continue;
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
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ original_filename: att.filename, error_message: msg });
    }
  }

  return { attachments_processed: processed, skipped, errors };
}
