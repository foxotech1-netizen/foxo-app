// =============================================================================
// SOURCE DE VÉRITÉ UNIQUE — catégories de mail FoxO
// -----------------------------------------------------------------------------
// Ce module est le SEUL endroit qui définit la classification d'un mail et le
// label Gmail correspondant. Toute autre couche (agent cron, analyse deep, UI)
// doit converger ici. Il réconcilie aussi les deux vocabulaires hérités
// (type_email du cron, MailAnalyseType de l'analyse deep) vers le canonique.
//
// Classification canonique = spec doc 03 (Fiches Agents) + ajout autorisé
// "demarchage" (pub / prospection). La classification PILOTE le label Gmail.
// =============================================================================

export const MAIL_CLASSIFICATIONS = [
  "nouvelle_demande",
  "relance_syndic",
  "reponse_occupant",
  "demande_rapport",
  "question_facturation",
  "urgence",
  "demarchage",
  "autre",
] as const;

export type MailClassification = (typeof MAIL_CLASSIFICATIONS)[number];

export const MAIL_GMAIL_LABELS = [
  "FoxO/Intervention",
  "FoxO/Rapport",
  "FoxO/Comptable",
  "FoxO/Occupant",
  "FoxO/Démarchage",
  "FoxO/Autre",
] as const;

export type MailGmailLabel = (typeof MAIL_GMAIL_LABELS)[number];

// Quel label Gmail poser pour chaque classification canonique.
export const CLASSIFICATION_TO_LABEL: Record<MailClassification, MailGmailLabel> = {
  nouvelle_demande: "FoxO/Intervention",
  relance_syndic: "FoxO/Intervention",
  urgence: "FoxO/Intervention",
  demande_rapport: "FoxO/Rapport",
  question_facturation: "FoxO/Comptable",
  reponse_occupant: "FoxO/Occupant",
  demarchage: "FoxO/Démarchage",
  autre: "FoxO/Autre",
};

// Libellés humains FR (affichage admin uniquement).
export const CLASSIFICATION_LABEL_FR: Record<MailClassification, string> = {
  nouvelle_demande: "Nouvelle demande",
  relance_syndic: "Relance syndic",
  reponse_occupant: "Réponse occupant",
  demande_rapport: "Demande de rapport",
  question_facturation: "Question facturation",
  urgence: "Urgence",
  demarchage: "Démarchage / pub",
  autre: "Autre",
};

// --- Réconciliation des taxonomies héritées -------------------------------

// Ancien vocabulaire du cron (CronMailAnalysis.type_email).
const LEGACY_CRON_TYPE_EMAIL: Record<string, MailClassification> = {
  nouvelle_demande: "nouvelle_demande",
  suivi_dossier: "relance_syndic",
  confirmation_rdv: "reponse_occupant",
  annulation: "reponse_occupant",
  rapport_demande: "demande_rapport",
  assurance: "autre",
  autre: "autre",
};

// Ancien vocabulaire de l'analyse deep UI (MailAnalyseType).
const LEGACY_DEEP_TYPE: Record<string, MailClassification> = {
  demande_intervention: "nouvelle_demande",
  relance_rapport: "demande_rapport",
  suivi_dossier: "relance_syndic",
  question_generale: "autre",
  accuse_reception: "autre",
  spam_commercial: "demarchage",
};

const VALID_CLASSIFICATIONS = new Set<string>(MAIL_CLASSIFICATIONS);

/**
 * Convertit n'importe quelle valeur (canonique, héritée cron, héritée deep,
 * ou inconnue) vers la classification canonique. Inconnu / vide -> "autre".
 */
export function toCanonicalClassification(
  value: string | null | undefined,
): MailClassification {
  if (!value) return "autre";
  const v = value.trim();
  if (VALID_CLASSIFICATIONS.has(v)) return v as MailClassification;
  const fromCron = LEGACY_CRON_TYPE_EMAIL[v];
  if (fromCron) return fromCron;
  const fromDeep = LEGACY_DEEP_TYPE[v];
  if (fromDeep) return fromDeep;
  return "autre";
}

/** Label Gmail à poser pour une valeur de classification (quelle que soit sa source). */
export function gmailLabelForClassification(
  value: string | null | undefined,
): MailGmailLabel {
  return CLASSIFICATION_TO_LABEL[toCanonicalClassification(value)];
}
