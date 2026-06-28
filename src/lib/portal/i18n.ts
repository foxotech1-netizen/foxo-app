// i18n portail FoxO — moteur multi-langues, extensible.
// Ajouter une langue = ajouter son code ci-dessous + fournir les traductions.
// Tout texte manquant retombe automatiquement sur le FR.
// NOTE: traductions NL/EN generees par Claude — A FAIRE RELIRE par un natif (NL surtout).

export type Lang = 'fr' | 'nl' | 'en';

export const LANGS: { code: Lang; label: string }[] = [
  { code: 'fr', label: 'FR' },
  { code: 'nl', label: 'NL' },
  { code: 'en', label: 'EN' },
];

export const DEFAULT_LANG: Lang = 'fr';
export const PORTAL_LANG_COOKIE = 'portal_lang';

export function normalizeLang(value: string | null | undefined): Lang {
  return value === 'nl' || value === 'en' ? value : DEFAULT_LANG;
}

export function localeFor(lang: Lang): string {
  return lang === 'nl' ? 'nl-BE' : lang === 'en' ? 'en-GB' : 'fr-BE';
}

export type PortalStringKey =
  | 'home' | 'dashboard' | 'planning' | 'newShort' | 'logout'
  | 'greeting' | 'statInProgress' | 'statPending' | 'statReportsAvailable' | 'statClosed'
  | 'reportsBannerSuffix' | 'nextAppointment' | 'see' | 'createFirst' | 'typeUnspecified'
  | 'availabilitiesTitle' | 'noSlots' | 'available'
  | 'accountNotLinkedTitle' | 'accountNotLinkedBody'
  | 'totalLabel' | 'dbLimited' | 'searchSyndic' | 'searchSinistre'
  | 'chipAll' | 'chipInProgress' | 'chipPending' | 'chipReportReady' | 'chipClosed'
  | 'periodAll' | 'period30d' | 'period3m' | 'period12m'
  | 'urgent' | 'reportBadge' | 'unreadFromFoxo' | 'createdLabel' | 'slotLabel'
  | 'thRef' | 'thAddress' | 'thStatus' | 'thCreated' | 'thTechnician'
  | 'bceLabel' | 'notAssigned' | 'reportAvailable' | 'ofTotal'
  // — Etape 3 : detail dossier —
  | 'plannedIntervention' | 'notConfirmed' | 'notYetAssigned' | 'lastUpdate'
  | 'yourInternalRef' | 'save' | 'saving' | 'refSavedMsg'
  | 'suspensionReason'
  | 'descriptionTitle' | 'interventionType' | 'initialDescription' | 'apartmentsConcerned' | 'aptShort' | 'preciseAddress'
  | 'reportIsAvailable' | 'downloadReport' | 'downloadInvoice' | 'reportInPreparation'
  | 'requestFollowUpTitle' | 'followUpSentMsg' | 'followUpIntro' | 'requestFollowUpButton' | 'sending' | 'followUpSendError' | 'networkError'
  | 'insuranceInfo' | 'insuranceCompany' | 'claimReference' | 'policyReference' | 'insurerContact' | 'actionRequired'
  | 'occupantsTitle' | 'confirmedSuffix' | 'occConfirmed' | 'occPending' | 'occDeclined'
  | 'billingTitle' | 'recipient' | 'emailLabel' | 'purchaseOrder';

const STRINGS: Record<Lang, Record<PortalStringKey, string>> = {
  fr: {
    home: 'Accueil', dashboard: 'Tableau de bord', planning: 'Planning', newShort: 'Nouveau', logout: 'Déconnexion',
    greeting: 'Bonjour', statInProgress: 'En cours', statPending: 'En attente', statReportsAvailable: 'Rapports dispo.', statClosed: 'Clôturées',
    reportsBannerSuffix: 'rapport(s) disponible(s) — consulter', nextAppointment: 'Prochain RDV', see: 'Voir', createFirst: 'Créer le premier', typeUnspecified: 'Type non précisé',
    availabilitiesTitle: 'Prochaines disponibilités FoxO', noSlots: 'Aucun créneau libre sur les 14 prochains jours.', available: 'Disponible',
    accountNotLinkedTitle: 'Compte non lié',
    accountNotLinkedBody: "Cette adresse n'est pas encore associée à un syndic, un courtier ou un expert dans nos fichiers. Contactez-nous pour finaliser l'ouverture de votre compte.",
    totalLabel: 'au total', dbLimited: 'Connexion à la base limitée :', searchSyndic: 'Rechercher — référence, ACP, adresse, BCE…', searchSinistre: 'Rechercher — référence, assuré, adresse, BCE, sinistre…',
    chipAll: 'Tous', chipInProgress: 'En cours', chipPending: 'En attente', chipReportReady: 'Rapport prêt', chipClosed: 'Clôturé',
    periodAll: 'Tout', period30d: '30 derniers jours', period3m: '3 derniers mois', period12m: '12 derniers mois',
    urgent: 'URGENT', reportBadge: 'Rapport', unreadFromFoxo: 'message(s) non lu(s) de FoxO', createdLabel: 'Créé', slotLabel: 'Créneau :',
    thRef: 'Réf.', thAddress: 'Adresse', thStatus: 'Statut', thCreated: 'Créé le', thTechnician: 'Technicien',
    bceLabel: 'BCE', notAssigned: 'Non assigné', reportAvailable: 'Rapport disponible', ofTotal: 'sur',
    // — Etape 3 —
    plannedIntervention: 'Intervention prévue', notConfirmed: 'Non confirmé', notYetAssigned: 'Non encore assigné', lastUpdate: 'Mise à jour',
    yourInternalRef: 'Votre référence interne', save: 'Enregistrer', saving: 'Enregistrement…', refSavedMsg: 'Référence enregistrée.',
    suspensionReason: 'Motif de suspension',
    descriptionTitle: 'Description', interventionType: "Type d'intervention", initialDescription: 'Description initiale', apartmentsConcerned: 'Appartement(s) concerné(s)', aptShort: 'Apt.', preciseAddress: 'Adresse précise',
    reportIsAvailable: "Le rapport d'intervention est disponible.", downloadReport: 'Télécharger le rapport', downloadInvoice: 'Télécharger la facture', reportInPreparation: "Rapport en cours de préparation. Vous serez notifié dès qu'il sera disponible.",
    requestFollowUpTitle: 'Demander une suite', followUpSentMsg: "Demande envoyée — l'équipe FoxO a été notifiée et vous répondra via la messagerie ci-dessous.", followUpIntro: "Un problème persiste ou vous souhaitez un nouveau passage sur ce dossier ? Envoyez une demande de suite : elle est transmise à l'équipe FoxO et apparaît dans la messagerie ci-dessous.", requestFollowUpButton: 'Demander une suite / révision', sending: 'Envoi…', followUpSendError: "Échec de l'envoi de la demande.", networkError: 'Erreur réseau.',
    insuranceInfo: 'Informations assurance', insuranceCompany: "Compagnie d'assurance", claimReference: 'Référence sinistre', policyReference: 'Référence police', insurerContact: 'Contact assureur', actionRequired: 'Action requise',
    occupantsTitle: 'Occupants', confirmedSuffix: 'confirmé(s)', occConfirmed: 'Confirmé', occPending: 'En attente', occDeclined: 'Décliné',
    billingTitle: 'Facturation', recipient: 'Destinataire', emailLabel: 'Email', purchaseOrder: 'Bon de commande',
  },
  nl: {
    home: 'Start', dashboard: 'Dashboard', planning: 'Planning', newShort: 'Nieuw', logout: 'Afmelden',
    greeting: 'Hallo', statInProgress: 'Lopend', statPending: 'In afwachting', statReportsAvailable: 'Rapporten besch.', statClosed: 'Afgesloten',
    reportsBannerSuffix: 'rapport(en) beschikbaar — bekijken', nextAppointment: 'Volgende afspraak', see: 'Bekijken', createFirst: 'Maak de eerste aan', typeUnspecified: 'Type niet opgegeven',
    availabilitiesTitle: 'Eerstvolgende beschikbaarheden FoxO', noSlots: 'Geen vrije momenten in de komende 14 dagen.', available: 'Beschikbaar',
    accountNotLinkedTitle: 'Account niet gekoppeld',
    accountNotLinkedBody: 'Dit adres is nog niet gekoppeld aan een syndicus, makelaar of expert in onze bestanden. Neem contact met ons op om uw account te activeren.',
    totalLabel: 'in totaal', dbLimited: 'Databaseverbinding beperkt:', searchSyndic: 'Zoeken — referentie, VME, adres, KBO…', searchSinistre: 'Zoeken — referentie, verzekerde, adres, KBO, schade…',
    chipAll: 'Alle', chipInProgress: 'Lopend', chipPending: 'In afwachting', chipReportReady: 'Rapport klaar', chipClosed: 'Afgesloten',
    periodAll: 'Alles', period30d: 'Laatste 30 dagen', period3m: 'Laatste 3 maanden', period12m: 'Laatste 12 maanden',
    urgent: 'DRINGEND', reportBadge: 'Rapport', unreadFromFoxo: 'ongelezen bericht(en) van FoxO', createdLabel: 'Aangemaakt', slotLabel: 'Tijdslot:',
    thRef: 'Ref.', thAddress: 'Adres', thStatus: 'Status', thCreated: 'Aangemaakt op', thTechnician: 'Technieker',
    bceLabel: 'KBO', notAssigned: 'Niet toegewezen', reportAvailable: 'Rapport beschikbaar', ofTotal: 'van',
    // — Etape 3 —
    plannedIntervention: 'Geplande interventie', notConfirmed: 'Niet bevestigd', notYetAssigned: 'Nog niet toegewezen', lastUpdate: 'Bijgewerkt',
    yourInternalRef: 'Uw interne referentie', save: 'Opslaan', saving: 'Opslaan…', refSavedMsg: 'Referentie opgeslagen.',
    suspensionReason: 'Reden van opschorting',
    descriptionTitle: 'Beschrijving', interventionType: 'Type interventie', initialDescription: 'Oorspronkelijke beschrijving', apartmentsConcerned: 'Betrokken appartement(en)', aptShort: 'App.', preciseAddress: 'Exact adres',
    reportIsAvailable: 'Het interventierapport is beschikbaar.', downloadReport: 'Rapport downloaden', downloadInvoice: 'Factuur downloaden', reportInPreparation: 'Rapport wordt voorbereid. U wordt verwittigd zodra het beschikbaar is.',
    requestFollowUpTitle: 'Een vervolg vragen', followUpSentMsg: 'Aanvraag verzonden — het FoxO-team is verwittigd en antwoordt u via de berichten hieronder.', followUpIntro: 'Blijft er een probleem of wenst u een nieuw bezoek voor dit dossier? Stuur een vervolgaanvraag: ze wordt doorgegeven aan het FoxO-team en verschijnt in de berichten hieronder.', requestFollowUpButton: 'Een vervolg / herziening vragen', sending: 'Verzenden…', followUpSendError: 'Verzenden van de aanvraag mislukt.', networkError: 'Netwerkfout.',
    insuranceInfo: 'Verzekeringsgegevens', insuranceCompany: 'Verzekeringsmaatschappij', claimReference: 'Schadereferentie', policyReference: 'Polisreferentie', insurerContact: 'Contact verzekeraar', actionRequired: 'Vereiste actie',
    occupantsTitle: 'Bewoners', confirmedSuffix: 'bevestigd', occConfirmed: 'Bevestigd', occPending: 'In afwachting', occDeclined: 'Geweigerd',
    billingTitle: 'Facturatie', recipient: 'Bestemmeling', emailLabel: 'E-mail', purchaseOrder: 'Bestelbon',
  },
  en: {
    home: 'Home', dashboard: 'Dashboard', planning: 'Schedule', newShort: 'New', logout: 'Log out',
    greeting: 'Hello', statInProgress: 'In progress', statPending: 'Pending', statReportsAvailable: 'Reports avail.', statClosed: 'Closed',
    reportsBannerSuffix: 'report(s) available — view', nextAppointment: 'Next appointment', see: 'View', createFirst: 'Create the first one', typeUnspecified: 'Type not specified',
    availabilitiesTitle: 'Next FoxO availability', noSlots: 'No free slots in the next 14 days.', available: 'Available',
    accountNotLinkedTitle: 'Account not linked',
    accountNotLinkedBody: 'This address is not yet linked to a property manager, broker or expert in our records. Contact us to finalise your account setup.',
    totalLabel: 'total', dbLimited: 'Database connection limited:', searchSyndic: 'Search — reference, co-ownership, address, reg. no.…', searchSinistre: 'Search — reference, insured, address, reg. no., claim…',
    chipAll: 'All', chipInProgress: 'In progress', chipPending: 'Pending', chipReportReady: 'Report ready', chipClosed: 'Closed',
    periodAll: 'All', period30d: 'Last 30 days', period3m: 'Last 3 months', period12m: 'Last 12 months',
    urgent: 'URGENT', reportBadge: 'Report', unreadFromFoxo: 'unread message(s) from FoxO', createdLabel: 'Created', slotLabel: 'Slot:',
    thRef: 'Ref.', thAddress: 'Address', thStatus: 'Status', thCreated: 'Created on', thTechnician: 'Technician',
    bceLabel: 'Company no.', notAssigned: 'Not assigned', reportAvailable: 'Report available', ofTotal: 'of',
    // — Etape 3 —
    plannedIntervention: 'Scheduled intervention', notConfirmed: 'Not confirmed', notYetAssigned: 'Not yet assigned', lastUpdate: 'Updated',
    yourInternalRef: 'Your internal reference', save: 'Save', saving: 'Saving…', refSavedMsg: 'Reference saved.',
    suspensionReason: 'Reason for suspension',
    descriptionTitle: 'Description', interventionType: 'Intervention type', initialDescription: 'Initial description', apartmentsConcerned: 'Apartment(s) concerned', aptShort: 'Apt.', preciseAddress: 'Precise address',
    reportIsAvailable: 'The intervention report is available.', downloadReport: 'Download the report', downloadInvoice: 'Download the invoice', reportInPreparation: 'Report being prepared. You will be notified as soon as it is available.',
    requestFollowUpTitle: 'Request a follow-up', followUpSentMsg: 'Request sent — the FoxO team has been notified and will reply via the messages below.', followUpIntro: 'Still having an issue or want another visit for this file? Send a follow-up request: it is forwarded to the FoxO team and appears in the messages below.', requestFollowUpButton: 'Request a follow-up / review', sending: 'Sending…', followUpSendError: 'Failed to send the request.', networkError: 'Network error.',
    insuranceInfo: 'Insurance information', insuranceCompany: 'Insurance company', claimReference: 'Claim reference', policyReference: 'Policy reference', insurerContact: 'Insurer contact', actionRequired: 'Action required',
    occupantsTitle: 'Occupants', confirmedSuffix: 'confirmed', occConfirmed: 'Confirmed', occPending: 'Pending', occDeclined: 'Declined',
    billingTitle: 'Billing', recipient: 'Recipient', emailLabel: 'Email', purchaseOrder: 'Purchase order',
  },
};

export function tFor(lang: Lang) {
  return (key: PortalStringKey): string =>
    STRINGS[lang]?.[key] ?? STRINGS[DEFAULT_LANG][key] ?? key;
}
