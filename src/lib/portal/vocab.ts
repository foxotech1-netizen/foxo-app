// Vocabulaire portail — adapte les libelles selon le type d'organisation ET la langue.
// Centralise pour coherence cross-ecran. Importable depuis server et client.
// NOTE: traductions NL/EN generees par Claude — A FAIRE RELIRE par un natif NL.

import { type Lang } from './i18n';

export type OrgType = 'syndic' | 'courtier' | 'expert';

export type PortalVocab = {
  portalLabel: string;
  intervention: string;
  interventionCap: string;
  interventions: string;
  interventionsCap: string;
  myInterventions: string;
  acpLabel: string;
  referenceLabel: string;
  newRequestVerb: string | null;
  emptyList: string;
  countSuffix: string;
  recentTitle: string;
  mapTitle: string;
  accent: string;
};

// Couleur accent par type d'org — independante de la langue.
const ACCENT: Record<OrgType, string> = {
  syndic: '#1B3A6B',
  courtier: '#1D6FA4',
  expert: '#F59E0B',
};

type VocabText = Omit<PortalVocab, 'accent'>;

const VOCAB_I18N: Record<Lang, Record<OrgType, VocabText>> = {
  fr: {
    syndic: { portalLabel: 'Portail Syndic', intervention: 'intervention', interventionCap: 'Intervention', interventions: 'interventions', interventionsCap: 'Interventions', myInterventions: 'Mes interventions', acpLabel: 'ACP', referenceLabel: 'Réf. syndic', newRequestVerb: '+ Nouvelle demande', emptyList: 'Aucune intervention', countSuffix: 'intervention(s)', recentTitle: 'Interventions récentes', mapTitle: 'Carte des interventions' },
    courtier: { portalLabel: 'Portail Courtier', intervention: 'dossier sinistre', interventionCap: 'Dossier sinistre', interventions: 'dossiers sinistres', interventionsCap: 'Dossiers sinistres', myInterventions: 'Mes dossiers', acpLabel: 'Assuré', referenceLabel: 'Réf. courtier', newRequestVerb: '+ Confier une mission', emptyList: 'Aucun dossier', countSuffix: 'dossier(s)', recentTitle: 'Dossiers récents', mapTitle: 'Carte des dossiers' },
    expert: { portalLabel: 'Portail Expert', intervention: 'dossier sinistre', interventionCap: 'Dossier sinistre', interventions: 'dossiers sinistres', interventionsCap: 'Dossiers sinistres', myInterventions: 'Mes dossiers', acpLabel: 'Assuré', referenceLabel: 'Réf. dossier', newRequestVerb: '+ Confier une mission', emptyList: 'Aucun dossier', countSuffix: 'dossier(s)', recentTitle: 'Dossiers récents', mapTitle: 'Carte des dossiers' },
  },
  nl: {
    syndic: { portalLabel: 'Syndicusportaal', intervention: 'interventie', interventionCap: 'Interventie', interventions: 'interventies', interventionsCap: 'Interventies', myInterventions: 'Mijn interventies', acpLabel: 'VME', referenceLabel: 'Ref. syndicus', newRequestVerb: '+ Nieuwe aanvraag', emptyList: 'Geen interventies', countSuffix: 'interventie(s)', recentTitle: 'Recente interventies', mapTitle: 'Kaart van de interventies' },
    courtier: { portalLabel: 'Makelaarsportaal', intervention: 'schadedossier', interventionCap: 'Schadedossier', interventions: 'schadedossiers', interventionsCap: 'Schadedossiers', myInterventions: 'Mijn dossiers', acpLabel: 'Verzekerde', referenceLabel: 'Ref. makelaar', newRequestVerb: '+ Opdracht toevertrouwen', emptyList: 'Geen dossiers', countSuffix: 'dossier(s)', recentTitle: 'Recente dossiers', mapTitle: 'Kaart van de dossiers' },
    expert: { portalLabel: 'Expertportaal', intervention: 'schadedossier', interventionCap: 'Schadedossier', interventions: 'schadedossiers', interventionsCap: 'Schadedossiers', myInterventions: 'Mijn dossiers', acpLabel: 'Verzekerde', referenceLabel: 'Ref. dossier', newRequestVerb: '+ Opdracht toevertrouwen', emptyList: 'Geen dossiers', countSuffix: 'dossier(s)', recentTitle: 'Recente dossiers', mapTitle: 'Kaart van de dossiers' },
  },
  en: {
    syndic: { portalLabel: 'Property Manager Portal', intervention: 'intervention', interventionCap: 'Intervention', interventions: 'interventions', interventionsCap: 'Interventions', myInterventions: 'My interventions', acpLabel: 'Co-ownership', referenceLabel: 'Manager ref.', newRequestVerb: '+ New request', emptyList: 'No interventions', countSuffix: 'intervention(s)', recentTitle: 'Recent interventions', mapTitle: 'Interventions map' },
    courtier: { portalLabel: 'Broker Portal', intervention: 'claim file', interventionCap: 'Claim file', interventions: 'claim files', interventionsCap: 'Claim files', myInterventions: 'My files', acpLabel: 'Insured', referenceLabel: 'Broker ref.', newRequestVerb: '+ Assign a mission', emptyList: 'No files', countSuffix: 'file(s)', recentTitle: 'Recent files', mapTitle: 'Files map' },
    expert: { portalLabel: 'Expert Portal', intervention: 'claim file', interventionCap: 'Claim file', interventions: 'claim files', interventionsCap: 'Claim files', myInterventions: 'My files', acpLabel: 'Insured', referenceLabel: 'File ref.', newRequestVerb: '+ Assign a mission', emptyList: 'No files', countSuffix: 'file(s)', recentTitle: 'Recent files', mapTitle: 'Files map' },
  },
};

export function vocabFor(type: OrgType | null | undefined, lang: Lang = 'fr'): PortalVocab {
  const t = type ?? 'syndic';
  return { ...VOCAB_I18N[lang][t], accent: ACCENT[t] };
}
