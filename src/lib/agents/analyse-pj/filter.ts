/**
 * src/lib/agents/analyse-pj/filter.ts
 *
 * Filtrage déterministe des pièces jointes : on écarte signatures,
 * vCard, ICS, fichiers trop volumineux. Aucune décision IA ici.
 */

import type { AttachmentInput, MimeClass, SkippedAttachment } from './types';

const MAX_SIZE_BYTES = 25 * 1024 * 1024;

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
  if (att.size_bytes > MAX_SIZE_BYTES) {
    return { keep: false, skipped: { original_filename: att.filename, reason: 'too_large' } };
  }

  const mime = att.mime_type.toLowerCase();

  if (VCARD_ICS_MIMES.has(mime)) {
    return { keep: false, skipped: { original_filename: att.filename, reason: 'vcard_ics' } };
  }

  const isLightImage = IMAGE_MIMES.has(mime) && att.size_bytes < 30 * 1024;
  const isSignatureName = SIGNATURE_NAME_PATTERNS.some((rx) => rx.test(att.filename));
  if (isLightImage && isSignatureName) {
    return { keep: false, skipped: { original_filename: att.filename, reason: 'signature_image' } };
  }

  if (PDF_MIMES.has(mime)) return { keep: true, mime_class: 'pdf' };
  if (IMAGE_MIMES.has(mime)) return { keep: true, mime_class: 'image' };

  return { keep: true, mime_class: 'office_v0_skip' };
}
