/**
 * src/lib/agents/analyse-pj/filter.ts
 *
 * Filtrage déterministe des pièces jointes : on écarte les signatures,
 * vCard, ICS, fichiers trop volumineux et formats non supportés en V0.
 * Aucune décision IA ici.
 */

import type { AttachmentInput, MimeClass, SkippedAttachment } from './types';

const MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB (cf. doc 03 cas d'erreur)

/** Heuristiques sur le nom de fichier pour repérer une signature de mail. */
const SIGNATURE_NAME_PATTERNS: RegExp[] = [
  /^image\d{3,4}\.(png|jpe?g|gif)$/i,
  /^signature/i,
  /^logo/i,
  /^atimg/i,
];

const VCARD_ICS_MIMES = new Set<string>([
  'text/calendar',
  'text/x-vcard',
  'text/vcard',
  'application/ics',
]);

const PDF_MIMES = new Set<string>(['application/pdf']);

const IMAGE_MIMES = new Set<string>([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export type FilterDecision =
  | { keep: true; mime_class: MimeClass }
  | { keep: false; skipped: SkippedAttachment };

export function classifyAttachment(att: AttachmentInput): FilterDecision {
  // 1. Taille
  if (att.size_bytes > MAX_SIZE_BYTES) {
    return {
      keep: false,
      skipped: { original_filename: att.filename, reason: 'too_large' },
    };
  }

  // 2. vCard / ICS
  if (VCARD_ICS_MIMES.has(att.mime_type.toLowerCase())) {
    return {
      keep: false,
      skipped: { original_filename: att.filename, reason: 'vcard_ics' },
    };
  }

  // 3. Signature visuelle (nom + image légère < 30 KB)
  const isLightImage =
    IMAGE_MIMES.has(att.mime_type.toLowerCase()) && att.size_bytes < 30 * 1024;
  const isSignatureName = SIGNATURE_NAME_PATTERNS.some((rx) => rx.test(att.filename));
  if (isLightImage && isSignatureName) {
    return {
      keep: false,
      skipped: { original_filename: att.filename, reason: 'signature_image' },
    };
  }

  // 4. PDF
  if (PDF_MIMES.has(att.mime_type.toLowerCase())) {
    return { keep: true, mime_class: 'pdf' };
  }

  // 5. Image
  if (IMAGE_MIMES.has(att.mime_type.toLowerCase())) {
    return { keep: true, mime_class: 'image' };
  }

  // 6. Tout le reste (Word, Excel, ZIP, etc.) → V0 = pas d'analyse LLM
  //    mais on garde la row dans `attachments` avec type_detecte=null.
  return { keep: true, mime_class: 'office_v0_skip' };
}
