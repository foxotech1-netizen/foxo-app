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
  newRequestVerb: string | null;  // null = portail en lecture seule (expert)
  emptyList: string;              // "Aucune intervention" / "Aucun dossier"
  countSuffix: string;            // "intervention(s)" / "dossier(s)"
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
    newRequestVerb: '+ Nouvelle demande',
    emptyList: 'Aucune intervention',
    countSuffix: 'intervention(s)',
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
    newRequestVerb: '+ Confier une mission',
    emptyList: 'Aucun dossier',
    countSuffix: 'dossier(s)',
    accent: '#1D6FA4',
  },
  expert: {
    // L'expert consulte des dossiers sinistres existants — il ne crée
    // pas de demande (newRequestVerb: null masque le CTA dans la nav,
    // dans le dashboard et dans la liste des interventions).
    portalLabel: 'Portail Expert',
    intervention: 'dossier sinistre',
    interventionCap: 'Dossier sinistre',
    interventions: 'dossiers sinistres',
    interventionsCap: 'Dossiers sinistres',
    myInterventions: 'Mes dossiers',
    acpLabel: 'Assuré',
    newRequestVerb: null,
    emptyList: 'Aucun dossier',
    countSuffix: 'dossier(s)',
    accent: '#F59E0B',
  },
};

export function vocabFor(type: OrgType | null | undefined): PortalVocab {
  return VOCAB[type ?? 'syndic'];
}
