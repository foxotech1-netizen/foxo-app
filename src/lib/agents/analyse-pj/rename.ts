/**
 * src/lib/agents/analyse-pj/rename.ts
 *
 * Convention de nommage des PJ archivées (doc 03 skill 14) :
 *   [ref_foxo]_[type_pj]_[date].[extension]
 *   Ex : 2026-146_declaration-sinistre_2026-04-15.pdf
 */

import type { DetectedType, TargetFolder } from './types';

const TYPE_TO_SLUG: Record<DetectedType, string> = {
  declaration_sinistre: 'declaration-sinistre',
  pv_constat: 'pv-constat',
  photo_degat: 'photo-degat',
  devis: 'devis',
  rapport_tiers: 'rapport-tiers',
  courrier: 'courrier',
  autre: 'autre',
};

const TYPE_TO_FOLDER: Record<DetectedType, TargetFolder> = {
  declaration_sinistre: 'PJ_recues',
  pv_constat: 'PJ_recues',
  photo_degat: 'Photos',
  devis: 'PJ_recues',
  rapport_tiers: 'PJ_recues',
  courrier: 'PJ_recues',
  autre: 'Communications',
};

export function buildNewFilename(args: {
  ref_foxo?: string | null;
  detected_type: DetectedType;
  date_document?: string | null;
  original_filename: string;
}): string {
  const ext = (args.original_filename.split('.').pop() ?? 'bin').toLowerCase();
  const ref = args.ref_foxo?.trim() || 'sans-ref';
  const slug = TYPE_TO_SLUG[args.detected_type];
  const date = args.date_document?.trim() || new Date().toISOString().slice(0, 10);
  return ref + '_' + slug + '_' + date + '.' + ext;
}

export function folderFor(detected_type: DetectedType): TargetFolder {
  return TYPE_TO_FOLDER[detected_type];
}
