// Types partagés entre MailsClient et les sous-composants
// MailAnalyseBadges / MailAnalyseActions / SmsModal.

export type MailAnalyseType =
  | 'demande_intervention'
  | 'relance_rapport'
  | 'suivi_dossier'
  | 'question_generale'
  | 'accuse_reception'
  | 'spam_commercial';

export interface MailAnalyseDossier {
  id: string;
  ref: string | null;
  adresse: string | null;
}

export interface MailAnalyseCreneau {
  date: string;
  heure_debut: string;
  heure_fin: string;
  technicien_nom: string;
}

export interface MailAnalyse {
  thread_id: string;
  type: MailAnalyseType | null;
  urgence: boolean | null;
  langue: 'fr' | 'nl' | 'en' | 'other' | null;
  adresse_extraite: string | null;
  numero_dossier_mentionne: string | null;
  resume: string | null;
  occupant_telephone: string | null;
  occupant_email: string | null;
  dossier_match_id: string | null;
  creneau_propose_id: string | null;
  fenetre_etendue: boolean | null;
  pj_drive_ids: string[] | null;
  brouillon_gmail_id: string | null;
  event_calendar_id: string | null;
  errors: string[] | null;
  dossier: MailAnalyseDossier | null;
  creneau: MailAnalyseCreneau | null;
}
