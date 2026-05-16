/**
 * src/lib/agents/analyse-pj/types.ts
 *
 * Types d'entrée/sortie de l'Agent 2 — Analyse PJ.
 * Conformes à doc 03 §Agent 2.
 */

export type DetectedType =
  | 'declaration_sinistre'
  | 'pv_constat'
  | 'photo_degat'
  | 'devis'
  | 'rapport_tiers'
  | 'courrier'
  | 'autre';

export type TargetFolder = 'Communications' | 'PJ_recues' | 'Photos';

export type AttachmentInput = {
  filename: string;
  mime_type: string;
  size_bytes: number;
  /** Contenu encodé en base64 (sans préfixe data:). */
  content_base64: string;
};

export type AnalyseContext = {
  intervention_id?: string | null;
  email_id?: string | null;
  /** Référence FoxO (ex. "2026-146"). Sert au renommage. */
  ref_foxo?: string | null;
  /** Clés métier à privilégier dans l'extraction (purement indicatif). */
  expected_data?: string[];
  language_hint?: 'fr' | 'nl' | 'en';
};

export type AnalysedAttachment = {
  /** UUID de la row insérée dans `attachments`. */
  attachment_id: string;
  original_filename: string;
  detected_type: DetectedType | null;
  new_filename: string | null;
  extracted_data: Record<string, unknown>;
  target_folder: TargetFolder | null;
  confidence: number | null;
  content_summary: string | null;
  /** URL Drive si upload réussi, null si pas d'upload tenté ou si échec. */
  drive_url: string | null;
  /** File ID Drive si upload réussi, null sinon. */
  drive_file_id: string | null;
  /** Message d'erreur si l'upload Drive a foiré (l'analyse, elle, a réussi). */
  drive_error: string | null;
};

export type SkippedAttachment = {
  original_filename: string;
  reason: 'signature_image' | 'vcard_ics' | 'too_large' | 'unsupported_format_v0';
};

export type AttachmentError = {
  original_filename: string;
  error_message: string;
};

export type AnalyseInput = {
  attachments: AttachmentInput[];
  context: AnalyseContext;
};

export type AnalyseOutput = {
  attachments_processed: AnalysedAttachment[];
  skipped: SkippedAttachment[];
  errors: AttachmentError[];
};

/** Classe MIME interne pour aiguiller l'analyseur. */
export type MimeClass = 'pdf' | 'image' | 'office_v0_skip';
