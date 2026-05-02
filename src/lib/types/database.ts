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

export interface ParticulierAdresse {
  rue: string;
  code_postal: string;
  ville: string;
}

export interface ParticulierMandant {
  prenom: string;
  nom: string;
  email: string;
  tel: string;
  adresse_facturation: ParticulierAdresse;
  bce?: string;
}

export interface ParticulierLieu {
  meme_que_mandant: boolean;
  rue: string;
  cp: string;
  ville: string;
}

export interface ParticulierContactSurPlace {
  actif: boolean;
  prenom?: string;
  nom?: string;
  tel?: string;
  email?: string;
  instructions?: string;
}

// Le contact d'origine reste aplati (rétrocompatibilité avec les anciennes
// interventions et avec les emails / PDFs qui utilisent ces champs).
// Les sous-objets `mandant` / `lieu` / `contact_sur_place` sont la nouvelle
// structure exposée à partir du formulaire /rdv.
export interface ParticulierContact {
  prenom: string;
  nom: string;
  email: string;
  telephone: string;
  adresse: ParticulierAdresse;
  // Nouvelle structure étendue (formulaire /rdv refondu)
  mandant?: ParticulierMandant;
  lieu?: ParticulierLieu;
  contact_sur_place?: ParticulierContactSurPlace;
}

export type DelegueRole = 'admin' | 'delegue';

export interface Delegue {
  id: string;
  organisation_id: string;
  email: string;
  prenom: string | null;
  nom: string | null;
  telephone: string | null;
  role: DelegueRole;
  actif: boolean;
  invite_sent_at: string | null;
  created_at: string;
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
  // Emails fonctionnels dédiés (override de `email`). NULL = retombe
  // sur le legacy `email`.
  email_factures: string | null;
  email_rapports: string | null;
  email_communications: string | null;
  created_at?: string;
}

export interface Acp {
  id: string;
  nom: string;
  adresse: string | null;
  ville: string | null;
  code_postal: string | null;
  bce: string | null;
  // Emails legacy (un seul champ pour rapport, un seul pour factu)
  email_rapport: string | null;
  email_facturation: string | null;
  // Emails fonctionnels dédiés — overrident le syndic. NULL = hérite.
  email_factures: string | null;
  email_rapports: string | null;
  email_communications: string | null;
  // Syndic gestionnaire de l'ACP (lien explicite, en plus du lien
  // implicite par intervention.syndic_id).
  syndic_id_ref: string | null;
}

export interface Utilisateur {
  id: string;
  prenom: string | null;
  nom: string | null;
  email: string | null;
  couleur: string | null;     // hex personnalisée pour le planning
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
  source: 'rdv' | 'portal' | 'admin' | 'mail' | 'calendar' | 'portail' | null;
  source_mail_id: string | null;     // Gmail message ID si source='mail'
  color: string | null;     // hex (#RRGGBB) — override couleur planning
  reference_externe: string | null;
  organisation_id: string | null;
  client_id: string | null;
  delegue_id: string | null;
  notes_tech: string | null;
  action_requise: string | null;
  assureur: {
    nom: string | null;
    email: string | null;
    telephone: string | null;
    reference_sinistre: string | null;
    reference_police: string | null;
  } | null;
  appartements_concernes: string[] | null;
  deleted_at: string | null;
}

export interface Rapport {
  intervention_id: string;
  degats: string;
  inspection: string;
  conclusion: string;
  recommandations: string;
  updated_at: string;
}

export type ContactPreference = 'email' | 'sms' | 'whatsapp' | 'both';

export type TypeOccupant = 'occupant' | 'proprietaire' | 'parties_communes';

export interface Occupant {
  id: string;
  intervention_id: string;
  appartement: string | null;
  prenom: string | null;
  nom: string | null;
  email: string | null;
  telephone: string | null;
  etage: string | null;
  instructions: string | null;
  conf: 'confirme' | 'en_attente' | 'decline' | null;
  contact_preference: ContactPreference | null;
  type_occupant: TypeOccupant | null;
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

// ─── Clients ─────────────────────────────────────────────────────────────

export type TypeClient = 'acp' | 'particulier' | 'entreprise';

export interface Client {
  id: string;
  type: TypeClient;
  nom: string;
  prenom: string | null;
  email: string | null;
  telephone: string | null;
  adresse: string | null;
  code_postal: string | null;
  ville: string | null;
  pays: string | null;
  bce: string | null;
  tva: string | null;
  contact_nom: string | null;
  contact_email: string | null;
  contact_telephone: string | null;
  notes: string | null;
  actif: boolean;
  // Syndic gestionnaire (clients de type 'acp') + emails dédiés override
  syndic_id_ref: string | null;
  email_factures: string | null;
  email_rapports: string | null;
  email_communications: string | null;
  created_at: string;
  updated_at: string;
}

export const TYPE_CLIENT_LABEL: Record<TypeClient, string> = {
  acp: 'ACP',
  particulier: 'Particulier',
  entreprise: 'Entreprise',
};

// ─── Facturation ─────────────────────────────────────────────────────────

export type StatutFacture = 'brouillon' | 'envoyee' | 'payee' | 'en_retard' | 'annulee';

export interface FactureLigne {
  description: string;
  quantite: number;
  prix_unitaire: number;     // HT
  tva_pct: number;
  notes?: string;            // ligne de détail en italic sous la description
  article_code?: string;
}

export interface FactureDetailsIntervention {
  ref_dossier?: string;
  appartements?: string;
  adresse_intervention?: string;
  reference_assurance?: string;
}

export interface Facture {
  id: string;
  numero: string;
  intervention_id: string | null;
  organisation_id: string | null;
  client_id: string | null;
  client_nom: string | null;
  client_email: string | null;
  client_adresse: string | null;
  client_bce: string | null;
  client_syndic: string | null;
  lignes: FactureLigne[];
  details_intervention: FactureDetailsIntervention;
  remise_pct: number;
  tva_pct: number;
  montant_ht: number | null;
  montant_tva: number | null;
  montant_ttc: number | null;
  notes: string | null;
  remarques: string | null;
  conditions_paiement: string;
  reference: string | null;
  reference_structuree: string | null;
  statut: StatutFacture;
  date_emission: string | null;
  date_echeance: string | null;
  date_paiement: string | null;
  sent_at: string | null;
  rappel_envoye_at: string | null;
  rappel_count: number | null;
  created_at: string;
  updated_at: string;
}

export interface Article {
  id: string;
  code: string | null;
  description: string;
  prix_htva: number;
  tva_pct: number;
  actif: boolean;
  created_at: string;
}

export interface Parametre {
  id: string;
  cle: string;
  valeur: string | null;
  updated_at: string;
}

export const STATUT_FACTURE_INFO: Record<StatutFacture, { label: string; fg: string; bg: string }> = {
  brouillon: { label: 'Brouillon',  fg: '#6B6558', bg: '#EDEAE3' },
  envoyee:   { label: 'Envoyée',    fg: '#1B3A6B', bg: '#D6E4F7' },
  payee:     { label: 'Payée',      fg: '#1F6B45', bg: '#D4EDE2' },
  en_retard: { label: 'En retard',  fg: '#C4622D', bg: '#F7EDE5' },
  annulee:   { label: 'Annulée',    fg: '#A09A8E', bg: '#E4DFD4' },
};

// Vue jointe — utilisée par l'admin
export interface InterventionRow extends Intervention {
  acp: Pick<Acp, 'id' | 'nom' | 'adresse' | 'ville'> | null;
  syndic: Pick<Organisation, 'id' | 'nom' | 'type' | 'email'> | null;
  technicien: Pick<Utilisateur, 'id' | 'prenom' | 'nom'> | null;
  delegue: Pick<Delegue, 'id' | 'prenom' | 'nom' | 'email' | 'telephone'> | null;
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
