// Vocabulaire portail — adapte les libellés selon le type d'organisation connectée.
// Centralisé pour cohérence cross-écran. Importable depuis server et client.

export type OrgType = 'syndic' | 'courtier' | 'expert';

export type PortalVocab = {
  portalLabel: string;            // sous-titre bannière
  intervention: string;           // singulier minuscule
  interventionCap: string;        // singulier capitalisé
  interventions: string;          // pluriel
  interventionsCap: string;       // pluriel capitalisé
  myInterventions: string;        // "Mes interventions" / "Mes dossiers"
  acpLabel: string;               // "ACP" / "Assuré"
  referenceLabel: string;         // libellé de interventions.reference_externe selon le rôle
  newRequestVerb: string | null;  // null = portail en lecture seule (aucun type ne l'utilise aujourd'hui)
  emptyList: string;              // "Aucune intervention" / "Aucun dossier"
  countSuffix: string;            // "intervention(s)" / "dossier(s)"
  recentTitle: string;            // titre section récents (accord géré ici, pas de concat)
  mapTitle: string;               // titre carte ("Carte des interventions" / "…dossiers")
  accent: string;                 // hex couleur accent spécifique
};

export const VOCAB: Record<OrgType, PortalVocab> = {
  syndic: {
    portalLabel: 'Portail Syndic',
    intervention: 'intervention',
    interventionCap: 'Intervention',
    interventions: 'interventions',
    interventionsCap: 'Interventions',
    myInterventions: 'Mes interventions',
    acpLabel: 'ACP',
    referenceLabel: 'Réf. syndic',
    newRequestVerb: '+ Nouvelle demande',
    emptyList: 'Aucune intervention',
    countSuffix: 'intervention(s)',
    recentTitle: 'Interventions récentes',
    mapTitle: 'Carte des interventions',
    accent: '#1B3A6B',
  },
  courtier: {
    portalLabel: 'Portail Courtier',
    intervention: 'dossier sinistre',
    interventionCap: 'Dossier sinistre',
    interventions: 'dossiers sinistres',
    interventionsCap: 'Dossiers sinistres',
    myInterventions: 'Mes dossiers',
    acpLabel: 'Assuré',
    referenceLabel: 'Réf. courtier',
    newRequestVerb: '+ Confier une mission',
    emptyList: 'Aucun dossier',
    countSuffix: 'dossier(s)',
    recentTitle: 'Dossiers récents',
    mapTitle: 'Carte des dossiers',
    accent: '#1D6FA4',
  },
  expert: {
    // L'expert peut créer une demande d'intervention pour le compte de
    // ses clients (cabinet d'expertise mandaté pour diligenter une
    // mission de constat / chiffrage).
    portalLabel: 'Portail Expert',
    intervention: 'dossier sinistre',
    interventionCap: 'Dossier sinistre',
    interventions: 'dossiers sinistres',
    interventionsCap: 'Dossiers sinistres',
    myInterventions: 'Mes dossiers',
    acpLabel: 'Assuré',
    referenceLabel: 'Réf. dossier',
    newRequestVerb: '+ Confier une mission',
    emptyList: 'Aucun dossier',
    countSuffix: 'dossier(s)',
    recentTitle: 'Dossiers récents',
    mapTitle: 'Carte des dossiers',
    accent: '#F59E0B',
  },
};

export function vocabFor(type: OrgType | null | undefined): PortalVocab {
  return VOCAB[type ?? 'syndic'];
}
