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

export type OccupantExtraitType =
  | 'occupant'
  | 'proprietaire'
  | 'locataire'
  | 'concierge'
  | 'voisin'
  | 'gestionnaire'
  | 'parties_communes'
  | 'autre';

// Miroir exact de AnalyseDeepOccupant émis par Agent 1
// (analyse-deep/route.ts, via normalizeOccupants). Tous les champs sont
// garantis présents (string vide si absent), d'où l'absence d'optionnel.
export interface OccupantExtrait {
  prenom: string;
  nom: string;
  email: string;
  telephone: string;
  appartement: string;
  etage: string;
  type: OccupantExtraitType;
  remarques: string;
}

export type ContactPreference = 'email' | 'sms' | 'whatsapp' | 'both';

// État UI éditable d'un occupant dans ConfirmCreateForm. Miroir
// d'OccupantExtrait enrichi des champs serveur attendus par
// safeInsertOccupants (conf est posé côté route en 1.c, pas ici).
export interface ConfirmCreateOccupant {
  prenom: string;
  nom: string;
  email: string;
  telephone: string;
  appartement: string;
  etage: string;
  type: OccupantExtraitType;
  instructions: string;
  contact_preference: ContactPreference;
}

export function emptyConfirmCreateOccupant(): ConfirmCreateOccupant {
  return {
    prenom: '',
    nom: '',
    email: '',
    telephone: '',
    appartement: '',
    etage: '',
    type: 'occupant',
    instructions: '',
    contact_preference: 'email',
  };
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
  occupants_extraits: OccupantExtrait[] | null;
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
