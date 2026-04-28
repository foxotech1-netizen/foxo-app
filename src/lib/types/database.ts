// Types DB — saisie manuelle d'après le schéma utilisé par les anciens HTML.
// À remplacer par `supabase gen types typescript` quand on aura la CLI liée.

// Enum côté Postgres : intervention_statut
// Source : Supabase, valeurs exactes (ne pas modifier sans ALTER TYPE).
export type StatutIntervention =
  | 'nouvelle'
  | 'attente'
  | 'confirmee'
  | 'realisee'
  | 'rapport'
  | 'cloturee'
  | 'en_suspens';

// Pipeline visuel (ordre dans la barre de progression).
// `en_suspens` n'en fait pas partie — c'est un état "pause" hors-flow.
export const STATUT_PIPELINE: StatutIntervention[] = [
  'nouvelle',
  'attente',
  'confirmee',
  'realisee',
  'rapport',
  'cloturee',
];

export type PrioriteIntervention = 'normale' | 'urgente';

export type TypeIntervention =
  | 'Fuite canalisation'
  | 'Fuite chauffage'
  | 'Fuite infiltration'
  | 'Surconsommation eau'
  | 'Autre';

export type TypeOrganisation = 'syndic' | 'courtier';

export type DemandeurType = 'particulier' | 'syndic' | 'courtier';

export interface ParticulierContact {
  prenom: string;
  nom: string;
  email: string;
  telephone: string;
  adresse: {
    rue: string;
    code_postal: string;
    ville: string;
  };
}

export interface Organisation {
  id: string;
  nom: string;
  type: TypeOrganisation;
  email: string;
  contact: string | null;
  telephone: string | null;
  bce: string | null;
  adresse: string | null;
  created_at?: string;
}

export interface Acp {
  id: string;
  nom: string;
  adresse: string | null;
  ville: string | null;
  code_postal: string | null;
  bce: string | null;
  email_rapport: string | null;
  email_facturation: string | null;
}

export interface Utilisateur {
  id: string;
  prenom: string | null;
  nom: string | null;
  email: string | null;
}

export interface Intervention {
  id: string;
  ref: string | null;
  statut: StatutIntervention;
  priorite: PrioriteIntervention;
  type: string | null;
  description: string | null;
  creneau_debut: string | null;
  updated_at: string;
  created_at: string;
  suspens_motif: string | null;
  syndic_id: string | null;
  acp_id: string | null;
  technicien_id: string | null;
  adresse: string | null;
  nom_facturation: string | null;
  email_facturation: string | null;
  bce_facturation: string | null;
  ref_bon_commande: string | null;
  date_demande: string | null;
  started_at: string | null;
  ended_at: string | null;
  demandeur_type: DemandeurType | null;
  particulier_contact: ParticulierContact | null;
}

export interface Rapport {
  intervention_id: string;
  degats: string;
  inspection: string;
  conclusion: string;
  recommandations: string;
  updated_at: string;
}

export interface Occupant {
  id: string;
  intervention_id: string;
  appartement: string | null;
  nom: string | null;
  email: string | null;
  telephone: string | null;
  conf: 'confirme' | 'en_attente' | 'decline' | null;
}

export type StatutCreneau = 'libre' | 'reserve' | 'bloque';

export interface CreneauDisponible {
  id: string;
  technicien_id: string | null;
  date: string;            // YYYY-MM-DD
  heure_debut: string;     // "HH:MM"
  heure_fin: string;       // "HH:MM"
  statut: StatutCreneau;
  intervention_id: string | null;
  google_event_id: string | null;
  created_at: string;
}

export interface CreneauBloque {
  id: string;
  date: string;            // YYYY-MM-DD
  heure: string | null;    // "HH:MM" ou null = journée entière
  technicien_id: string | null;
  motif: string | null;
  google_event_id: string | null;
  created_at: string;
}

// Vue jointe — utilisée par l'admin
export interface InterventionRow extends Intervention {
  acp: Pick<Acp, 'id' | 'nom' | 'adresse' | 'ville'> | null;
  syndic: Pick<Organisation, 'id' | 'nom' | 'type' | 'email'> | null;
  technicien: Pick<Utilisateur, 'id' | 'prenom' | 'nom'> | null;
}

// Libellés et couleurs des statuts
export const STATUT_INFO: Record<StatutIntervention, { label: string; fg: string; bg: string }> = {
  nouvelle:    { label: 'Nouvelle',     fg: '#6B6558', bg: '#EDEAE3' },
  attente:     { label: 'En attente',   fg: '#2A5298', bg: '#D6E4F7' },
  confirmee:   { label: 'Confirmée',    fg: '#1B3A6B', bg: '#D6E4F7' },
  realisee:    { label: 'Réalisée',     fg: '#1B3A6B', bg: '#A8D4E8' },
  rapport:     { label: 'Rapport dispo.', fg: '#1F6B45', bg: '#D4EDE2' },
  cloturee:    { label: 'Clôturée',     fg: '#6B6558', bg: '#E4DFD4' },
  en_suspens:  { label: 'En suspens',   fg: '#C4622D', bg: '#F7EDE5' },
};
