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

export type TypeOrganisation =
  | 'syndic'
  | 'courtier'
  | 'assurance'
  | 'expert'
  | 'entrepreneur'
  | 'plombier'
  | 'electricien'
  | 'toiturier'
  | 'chauffagiste'
  | 'autre_metier';

// Sous-ensembles utilisés par les pages /admin/{syndics,courtiers,experts,metiers}.
// `metiers` regroupe les corps de métier sollicités sur intervention
// (sous-traitants techniques distincts des partenaires commerciaux).
export const ORGANISATION_TYPES_METIERS: TypeOrganisation[] = [
  'entrepreneur', 'plombier', 'electricien', 'toiturier', 'chauffagiste', 'autre_metier',
];

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
  // Coordonnées Nominatim (cf. migration 2026-05-18_address_coords.sql).
  // Utilisées pour la carte interactive du dashboard portail syndic.
  lat: number | null;
  lng: number | null;
}

// Enum PostgreSQL côté DB. Ne pas confondre avec le type `Role` applicatif
// de src/lib/auth/roles.ts ('admin' | 'tech' | 'partner') qui pilote le
// routage par sous-domaine via la whitelist d'emails — ce sont deux
// systèmes indépendants.
export type RoleUtilisateur = 'admin' | 'syndic' | 'courtier' | 'technicien';

export interface Utilisateur {
  id: string;
  prenom: string | null;
  nom: string | null;
  email: string | null;
  couleur: string | null;     // hex personnalisée pour le planning
  role: RoleUtilisateur | null;
  actif: boolean;
  telephone: string | null;
  last_seen_at: string | null;
  created_at: string | null;
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
  // Suggestion d'ACP automatique du pipeline mail (cf. migration
  // 2026-05-26_acp_suggestion.sql). Posée quand le score est compris
  // entre 60 % et 84 %, l'admin doit confirmer/ignorer depuis le drawer.
  acp_suggestion: {
    nom_extrait: string;
    acp_id_suggere: string;
    score: number;       // ∈ [0, 1]
  } | null;
  deleted_at: string | null;
  // Coordonnées Nominatim (cf. migration 2026-05-18_address_coords.sql).
  // Utilisées pour la carte interactive du dashboard portail syndic.
  lat: number | null;
  lng: number | null;
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

export type TypeOccupant =
  | 'occupant'
  | 'proprietaire'
  | 'locataire'
  | 'concierge'
  | 'voisin'
  | 'gestionnaire'
  | 'parties_communes'
  | 'autre';

// Libellés FR pour l'UI (drawer admin, sélecteurs). L'ordre du Record
// est l'ordre d'affichage dans les <select> via Object.entries().
export const TYPE_OCCUPANT_LABEL: Record<TypeOccupant, string> = {
  occupant:         'Occupant',
  proprietaire:     'Propriétaire',
  locataire:        'Locataire',
  concierge:        'Concierge',
  voisin:           'Voisin',
  gestionnaire:     'Gestionnaire',
  parties_communes: 'Parties communes',
  autre:            'Autre',
};

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
  confirmation_token: string | null;
  token_sent_at: string | null;
  confirmed_at: string | null;
  proposed_creneau_debut: string | null;
  proposed_creneau_fin: string | null;
  response_note: string | null;
}

export interface OccupantResponseLog {
  id: string;
  occupant_id: string;
  intervention_id: string;
  reponse: 'confirme' | 'decline' | 'counter';
  proposed_creneau_debut: string | null;
  proposed_creneau_fin: string | null;
  note: string | null;
  created_at: string;
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
  // Remise automatique pré-remplie sur les factures de ce client
  remise_auto_valeur: number;
  remise_auto_type: RemiseType | null;
  remise_auto_description: string | null;
  created_at: string;
  updated_at: string;
}

export const TYPE_CLIENT_LABEL: Record<TypeClient, string> = {
  acp: 'ACP',
  particulier: 'Particulier',
  entreprise: 'Entreprise',
};

// ─── Facturation ─────────────────────────────────────────────────────────

// Types de documents stockés dans la table factures.
//   facture : facture standard (défaut, comportement historique)
//   devis   : devis pré-vente, convertible en facture
//   avoir   : note de crédit, lié à une facture d'origine via facture_origine_id
export type TypeFacture = 'facture' | 'devis' | 'avoir';

// Statuts élargis pour gérer les états devis (accepte/refuse/expire).
// Sous-ensembles attendus par type — validation côté server actions :
//   facture : brouillon, envoyee, payee, en_retard, annulee
//   avoir   : brouillon, envoyee, annulee
//   devis   : brouillon, envoyee, accepte, refuse, expire, annulee
export type StatutFacture =
  | 'brouillon' | 'envoyee' | 'payee' | 'en_retard' | 'annulee'
  | 'accepte' | 'refuse' | 'expire';

// Remise sur ligne ou globale facture ou auto client.
//   pct  : pourcentage 0..100 appliqué sur le montant concerné
//   fixe : montant € absolu, ne peut pas dépasser le montant concerné
//          (vérifié applicativement, la DB ne connaît pas ce montant)
export type RemiseType = 'pct' | 'fixe';

export interface FactureLigne {
  description: string;
  quantite: number;
  prix_unitaire: number;     // HT
  tva_pct: number;
  notes?: string;            // ligne de détail en italic sous la description
  article_code?: string;
  // Remise au niveau ligne. Appliquée HTVA, avant le calcul de la TVA.
  // Tous les champs sont optionnels (rétro-compat avec les lignes
  // existantes en JSONB qui n'ont pas ces clés).
  remise_valeur?: number;
  remise_type?: RemiseType;
  remise_description?: string;
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
  // Legacy : ancienne remise % unique. Conservée en lecture pour rétro-compat
  // avec les factures émises avant la migration 2026-05-24_remises.sql.
  // À la création d'une facture, ne plus écrire dessus — utiliser
  // remise_globale_* à la place.
  remise_pct: number;
  // Remise globale sur le total HT de la facture (après remises lignes).
  remise_globale_valeur: number;
  remise_globale_type: RemiseType | null;
  remise_globale_description: string | null;
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
  // Type de document (cf. migration 2026-05-25_devis_avoirs.sql).
  type: TypeFacture;
  // Avoir : facture d'origine. NULL pour facture/devis.
  facture_origine_id: string | null;
  // Devis : durée de validité (en jours) à partir de date_emission.
  validite_jours: number | null;
  // Devis : timestamp de l'acceptation (sert au flag "converti")
  accepted_at: string | null;
  // Devis : si converti, l'id de la facture créée.
  converted_to_facture_id: string | null;
  // Soft delete (cf. 2026-05-25b_factures_deleted_at.sql) — pour
  // les brouillons supprimés depuis la liste. Les listings filtrent
  // toujours `deleted_at IS NULL`.
  deleted_at: string | null;
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
  // Statuts spécifiques aux devis
  accepte:   { label: 'Accepté',    fg: '#1F6B45', bg: '#D4EDE2' },
  refuse:    { label: 'Refusé',     fg: '#C4622D', bg: '#F7EDE5' },
  expire:    { label: 'Expiré',     fg: '#C4622D', bg: '#F7EDE5' },
};

// Vue jointe — utilisée par l'admin
export interface InterventionRow extends Intervention {
  acp: Pick<Acp, 'id' | 'nom' | 'adresse' | 'ville'> | null;
  syndic: Pick<Organisation, 'id' | 'nom' | 'type' | 'email'> | null;
  technicien: Pick<Utilisateur, 'id' | 'prenom' | 'nom'> | null;
  delegue: Pick<Delegue, 'id' | 'prenom' | 'nom' | 'email' | 'telephone'> | null;
  // Calculé côté /admin/page.tsx : nombre d'autres interventions sur la
  // même ACP avec le même type sur les 12 derniers mois. > 0 = récidive.
  recidive_count?: number;
  // Calculé côté /admin/page.tsx : nombre de messages non lus côté admin
  // (lu_admin=false ET auteur_type ∈ syndic/courtier) — alimente le badge
  // 💬 sur la liste interventions.
  unread_messages_count?: number;
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

// ─── Notes de frais (Sprint 6) ────────────────────────────────────────────

export type StatutNoteFrais = 'brouillon' | 'soumise' | 'approuvee' | 'rejetee' | 'remboursee';

// Catégories des notes de frais. Anciennes valeurs (transport, restauration,
// sous_traitance) conservées pour rétro-compat des rows historiques. Nouvelles
// valeurs alignées sur la classification comptable belge :
//   - Frais professionnels (déductible 100%, TVA récupérable)
//   - Frais de représentation (déductible 50%, TVA non récupérable)
export type CategorieNoteFrais =
  | 'carburant' | 'materiel' | 'outillage' | 'transport'
  | 'restauration' | 'fournitures' | 'sous_traitance' | 'autre'
  | 'restaurant' | 'cafe_client' | 'repas_travail' | 'reception'
  | 'telephonie' | 'formation' | 'autre_achat';

// Catégorie comptable dérivée de la catégorie utilisateur. Le trigger
// SQL `notes_frais_set_comptable` la calcule automatiquement BEFORE
// INSERT/UPDATE — le code TS n'a pas à la setter manuellement, juste
// à la lire.
export type CategorieComptable = 'professionnel' | 'representation';

const CATEGORIES_REPRESENTATION = new Set<CategorieNoteFrais>([
  'restaurant', 'cafe_client', 'repas_travail', 'reception', 'restauration',
]);

// Helper pur (sans dépendance DB) qui retourne la classification
// comptable d'une catégorie. Utilisé côté UI pour afficher les badges
// de déductibilité dans les formulaires sans attendre l'aller-retour
// serveur. Doit rester aligné avec le trigger SQL.
export function categorieComptable(c: CategorieNoteFrais): {
  comptable: CategorieComptable;
  tauxDeductibilite: number;
} {
  if (CATEGORIES_REPRESENTATION.has(c)) {
    return { comptable: 'representation', tauxDeductibilite: 50 };
  }
  return { comptable: 'professionnel', tauxDeductibilite: 100 };
}

export interface NoteFrais {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  technicien_email: string;
  technicien_nom: string | null;
  titre: string;
  categorie: CategorieNoteFrais;
  // Calculées côté DB par le trigger — read-only pour l'app
  categorie_comptable: CategorieComptable | null;
  taux_deductibilite: number | null;
  montant_htva: number;
  taux_tva: number;
  montant_ttc: number;
  fournisseur: string | null;
  date_depense: string;
  description: string | null;
  intervention_id: string | null;
  photo_url: string | null;
  photo_drive_id: string | null;
  ia_raw: Record<string, unknown> | null;
  ia_confiance: number | null;
  statut: StatutNoteFrais;
  note_admin: string | null;
  approved_at: string | null;
  approved_by: string | null;
}

// ─── Observabilité IA ─────────────────────────────────────────────────────
// Tables agent_logs / automation_jobs.
// Cf. migration 2026-05-13_create_agent_logs_automation_jobs.sql.
// Les valeurs CHECK SQL sont strictes — ne pas étendre sans ALTER.

export type AgentName = 'triage_mail' | 'analyse_pj' | 'rapport';
// NB: la DB utilise 'error' (pas 'failed') côté agent_logs — alignement
// historique avec doc 03 §spec, divergent de automation_jobs.status.
export type AgentLogStatus = 'success' | 'partial' | 'error';
export type AutomationJobStatus = 'success' | 'failed' | 'skipped';

export interface AgentLog {
  id: string;
  agent_name: AgentName;
  intervention_id: string | null;
  email_id: string | null;
  input_summary: Record<string, unknown> | null;
  output_summary: Record<string, unknown> | null;
  model_used: string | null;
  tokens_input: number | null;
  tokens_output: number | null;
  cost_eur_cents: number | null;
  duration_ms: number | null;
  status: AgentLogStatus;
  error_message: string | null;
  confidence_score: number | null;
  created_at: string;
}

export interface AutomationJob {
  id: string;
  automation_name: string;
  intervention_id: string | null;
  action: string | null;
  result: Record<string, unknown> | null;
  status: AutomationJobStatus;
  error_message: string | null;
  executed_at: string;
}
