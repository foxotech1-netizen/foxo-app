/**
 * src/lib/agents/analyse-pj/analyze-one.ts
 *
 * Analyse UNE pièce jointe via Claude (vision pour images, document pour PDF).
 * Encapsulée dans runAgent — doc 02 §10 oblige.
 *
 * Renvoie l'output structuré + l'enveloppe runAgent (logId, coût, durée).
 */

import Anthropic from '@anthropic-ai/sdk';
import { runAgent } from '@/lib/observability';
import type { AnalyseContext, AttachmentInput, DetectedType, MimeClass } from './types';
import { buildSystemPrompt } from './prompt';

const MODEL = 'claude-haiku-4-5-20251001';

export type LlmAnalysisResult = {
  detected_type: DetectedType;
  extracted_data: Record<string, unknown>;
  content_summary: string;
  confidence: number;
  language_detected: 'fr' | 'nl' | 'en';
};

const DETECTED_TYPES: ReadonlySet<DetectedType> = new Set([
  'declaration_sinistre',
  'pv_constat',
  'photo_degat',
  'devis',
  'rapport_tiers',
  'courrier',
  'autre',
]);

function isMediaTypeAccepted(mime: string): boolean {
  return [
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
  ].includes(mime.toLowerCase());
}

/**
 * Appel LLM pour UNE pièce jointe.
 * @throws si mime non supporté ou si JSON parse échoue (préfixe "JSON parse: ...").
 */
export async function analyzeOneAttachment(args: {
  attachment: AttachmentInput;
  mimeClass: MimeClass;
  context: AnalyseContext;
}) {
  const { attachment, mimeClass, context } = args;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquante.');
  if (mimeClass === 'office_v0_skip') {
    throw new Error('mime_class office_v0_skip : ne doit pas atteindre analyze-one.');
  }
  if (!isMediaTypeAccepted(attachment.mime_type)) {
    throw new Error(`mime_type non accepté: ${attachment.mime_type}`);
  }

  const systemPrompt = buildSystemPrompt(context);
  const client = new Anthropic({ apiKey });

  // Type de bloc selon mime_class. PDF → type 'document', image → type 'image'.
  // Les deux acceptent une source base64 côté SDK.
  const mediaBlock =
    mimeClass === 'pdf'
      ? {
          type: 'document' as const,
          source: {
            type: 'base64' as const,
            media_type: 'application/pdf' as const,
            data: attachment.content_base64,
          },
        }
      : {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: attachment.mime_type as
              | 'image/jpeg'
              | 'image/png'
              | 'image/webp'
              | 'image/gif',
            data: attachment.content_base64,
          },
        };

  return runAgent<LlmAnalysisResult>({
    agentName: 'analyse_pj',
    model: MODEL,
    interventionId: context.intervention_id ?? null,
    emailId: context.email_id ?? null,
    inputSummary: {
      mime_type: attachment.mime_type,
      size_bytes: attachment.size_bytes,
      mime_class: mimeClass,
      has_intervention_context: !!context.intervention_id,
      language_hint: context.language_hint ?? null,
    },
    run: async () => {
      const msg = await client.messages.create({
        model: MODEL,
        max_tokens: 1500,
        temperature: 0,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              mediaBlock,
              {
                type: 'text',
                text: 'Analyse cette pièce jointe et réponds en JSON selon le schéma.',
              },
            ],
          },
        ],
      });

      const block = msg.content.find((b) => b.type === 'text');
      const rawText = block && block.type === 'text' ? block.text : '';

      let parsed: LlmAnalysisResult;
      try {
        const cleaned = rawText
          .trim()
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/i, '');
        parsed = JSON.parse(cleaned) as LlmAnalysisResult;
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        throw new Error(
          `JSON parse: ${err} (preview: ${rawText.slice(0, 200)})`,
        );
      }

      // Garde-fou : detected_type doit appartenir à l'enum.
      if (!DETECTED_TYPES.has(parsed.detected_type)) {
        parsed.detected_type = 'autre';
      }
      // Garde-fou : confidence ∈ [0,1].
      if (typeof parsed.confidence !== 'number' || Number.isNaN(parsed.confidence)) {
        parsed.confidence = 0;
      }
      parsed.confidence = Math.max(0, Math.min(1, parsed.confidence));

      return {
        message: msg,
        output: parsed,
        outputSummary: {
          detected_type: parsed.detected_type,
          confidence: parsed.confidence,
          has_extracted_data:
            !!parsed.extracted_data && Object.keys(parsed.extracted_data).length > 0,
          summary_length: parsed.content_summary?.length ?? 0,
          language_detected: parsed.language_detected,
        },
        confidenceScore: parsed.confidence,
      };
    },
  });
}
