// Types partagés entre MailsClient et les sous-composants
// MailAnalyseBadges / MailAnalyseActions / SmsModal.

import type { MailClassification } from '@/lib/mail/categories';

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

// Phase 4 U1 — intention de réponse occupant extraite par analyse-deep,
// remontée depuis analyse_raw (pas de colonne dédiée en base). Présente
// seulement quand la classification vaut "reponse_occupant".
export type ReponseOccupantIntention = 'confirme' | 'refuse' | 'contre_proposition' | 'ambigu';

export interface ReponseOccupantIntent {
  intention: ReponseOccupantIntention;
  occupant_cible: string | null;
  creneau_propose: string | null;
}

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
  // U4 : classification canonique (categories.ts), écrite par analyse-deep.
  // Peut être null pour les anciennes lignes analysées avant U4 — l'UI
  // retombe alors sur toCanonicalClassification(type).
  classification: MailClassification | null;
  urgence: boolean | null;
  langue: 'fr' | 'nl' | 'en' | 'other' | null;
  adresse_extraite: string | null;
  numero_dossier_mentionne: string | null;
  resume: string | null;
  occupant_telephone: string | null;
  occupant_email: string | null;
  // Phase 3 — extraits par analyse-deep (null sur les lignes antérieures).
  acp_nom: string | null;
  syndic_nom: string | null;
  // Extrait d'analyse_raw côté route analyses (pas de colonne dédiée).
  type_intervention: string | null;
  // Phase 4 U1 — intention de réponse occupant, extraite d'analyse_raw côté
  // route analyses. null hors classification "reponse_occupant" / lignes
  // antérieures.
  reponse_occupant: ReponseOccupantIntent | null;
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
