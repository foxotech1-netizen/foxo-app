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
  | 'billingTitle' | 'recipient' | 'emailLabel' | 'purchaseOrder'
  // — Etape 4 : formulaire de nouvelle demande —
  | 'mustBeLinkedToCreate' | 'contactUsAt'
  | 'newRequestTitle' | 'assignMissionTitle' | 'wizardSubtitle'
  | 'stepClaim' | 'stepProblem' | 'stepSlot'
  | 'previous' | 'next' | 'assignMissionBtn' | 'submitRequestBtn'
  | 'buildingConcerned' | 'selectedSuffix' | 'change'
  | 'searchByNameOrBce' | 'searchAcpPlaceholder' | 'searchingEllipsis' | 'noAcpFoundFor' | 'createNewAcp' | 'newAcpTitle'
  | 'nameRequired' | 'acpNamePlaceholder' | 'buildingAddress' | 'addressPlaceholder' | 'bceNumber' | 'emailReport' | 'emailBilling' | 'cancel' | 'creatingEllipsis' | 'createAndSelect' | 'createError'
  | 'preciseAddressLabel' | 'preciseAddressPlaceholder' | 'optionalParen'
  | 'problemDescriptionTitle' | 'typeRequired' | 'selectPlaceholder' | 'descriptionRequired' | 'descriptionPlaceholder' | 'charactersCount' | 'priority' | 'priorityNormal' | 'priorityUrgent'
  | 'occupantsConcernedTitle' | 'occupantsHelp' | 'occupantN' | 'remove' | 'nameLabel' | 'phone' | 'addOccupant'
  | 'slotDesiredTitle' | 'slotNonContractual' | 'slotPreselected' | 'dateLabel' | 'timeLabel' | 'indifferentOption' | 'slotCanLeaveEmpty'
  | 'billingPrefilledHelp' | 'invoiceRecipient' | 'invoiceRecipientPlaceholder' | 'poReference'
  | 'insuredNameRequired' | 'insuredNamePlaceholder' | 'claimAddress' | 'claimAddressPlaceholder' | 'companyRefRequired' | 'companyRefOptional' | 'companyRefPlaceholder'
  | 'claimRefPlaceholder' | 'insuranceCompanyPlaceholder' | 'insuranceFieldsHelp' | 'companyRefHelp'
  // — Etape 5 : calendrier + cloche notifications —
  | 'availabilitiesPageTitle' | 'calendarSubtitle' | 'reserved' | 'notifications' | 'noNotifications' | 'justNow';

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
    plannedIntervention: 'Intervention prévue', notConfirmed: 'Non confirmé', notYetAssigned: 'Non encore assigné', lastUpdate: 'Mise à jour',
    yourInternalRef: 'Votre référence interne', save: 'Enregistrer', saving: 'Enregistrement…', refSavedMsg: 'Référence enregistrée.',
    suspensionReason: 'Motif de suspension',
    descriptionTitle: 'Description', interventionType: "Type d'intervention", initialDescription: 'Description initiale', apartmentsConcerned: 'Appartement(s) concerné(s)', aptShort: 'Apt.', preciseAddress: 'Adresse précise',
    reportIsAvailable: "Le rapport d'intervention est disponible.", downloadReport: 'Télécharger le rapport', downloadInvoice: 'Télécharger la facture', reportInPreparation: "Rapport en cours de préparation. Vous serez notifié dès qu'il sera disponible.",
    requestFollowUpTitle: 'Demander une suite', followUpSentMsg: "Demande envoyée — l'équipe FoxO a été notifiée et vous répondra via la messagerie ci-dessous.", followUpIntro: "Un problème persiste ou vous souhaitez un nouveau passage sur ce dossier ? Envoyez une demande de suite : elle est transmise à l'équipe FoxO et apparaît dans la messagerie ci-dessous.", requestFollowUpButton: 'Demander une suite / révision', sending: 'Envoi…', followUpSendError: "Échec de l'envoi de la demande.", networkError: 'Erreur réseau.',
    insuranceInfo: 'Informations assurance', insuranceCompany: "Compagnie d'assurance", claimReference: 'Référence sinistre', policyReference: 'Référence police', insurerContact: 'Contact assureur', actionRequired: 'Action requise',
    occupantsTitle: 'Occupants', confirmedSuffix: 'confirmé(s)', occConfirmed: 'Confirmé', occPending: 'En attente', occDeclined: 'Décliné',
    billingTitle: 'Facturation', recipient: 'Destinataire', emailLabel: 'Email', purchaseOrder: 'Bon de commande',
    mustBeLinkedToCreate: "Vous devez être associé à un syndic ou un courtier pour créer une demande.", contactUsAt: 'Contactez info@foxo.be',
    newRequestTitle: "Nouvelle demande d'intervention", assignMissionTitle: 'Confier une mission', wizardSubtitle: '5 étapes — vous pouvez revenir en arrière à tout moment',
    stepClaim: 'Sinistre', stepProblem: 'Problème', stepSlot: 'Créneau',
    previous: 'Précédent', next: 'Suivant', assignMissionBtn: 'Confier la mission', submitRequestBtn: 'Soumettre la demande',
    buildingConcerned: 'Immeuble concerné', selectedSuffix: 'sélectionnée', change: 'Changer',
    searchByNameOrBce: 'Rechercher par nom ou par numéro BCE', searchAcpPlaceholder: 'ex : Résidence Bellevue · BE0123.456.789', searchingEllipsis: 'Recherche…', noAcpFoundFor: 'Aucune ACP trouvée pour', createNewAcp: 'Créer une nouvelle ACP', newAcpTitle: 'Nouvelle ACP',
    nameRequired: 'Nom *', acpNamePlaceholder: 'Résidence Bellevue', buildingAddress: "Adresse de l'immeuble", addressPlaceholder: 'Avenue Louise 42, 1050 Bruxelles', bceNumber: 'Numéro BCE', emailReport: 'Email rapport', emailBilling: 'Email facturation', cancel: 'Annuler', creatingEllipsis: 'Création…', createAndSelect: 'Créer & sélectionner', createError: 'Erreur création.',
    preciseAddressLabel: "Adresse précise de l'intervention (si différente de l'ACP)", preciseAddressPlaceholder: 'ex : Apt 3B, étage 5', optionalParen: '(optionnel)',
    problemDescriptionTitle: 'Description du problème', typeRequired: 'Type *', selectPlaceholder: '— Sélectionner —', descriptionRequired: 'Description *', descriptionPlaceholder: "Décrivez le problème, l'étage, les dégâts visibles…", charactersCount: 'caractère(s)', priority: 'Priorité', priorityNormal: 'Normale', priorityUrgent: 'Urgente',
    occupantsConcernedTitle: 'Occupants concernés', occupantsHelp: 'Optionnel. Chacun recevra un lien de confirmation personnalisé une fois la demande validée.', occupantN: 'Occupant', remove: 'Supprimer', nameLabel: 'Nom', phone: 'Téléphone', addOccupant: 'Ajouter un occupant',
    slotDesiredTitle: 'Créneau souhaité', slotNonContractual: 'Non contractuel — FoxO confirmera sous 24h ouvrables.', slotPreselected: 'Créneau pré-sélectionné depuis le calendrier', dateLabel: 'Date', timeLabel: 'Heure', indifferentOption: '— Indifférent —', slotCanLeaveEmpty: 'Vous pouvez aussi laisser vide — FoxO vous proposera un créneau.',
    billingPrefilledHelp: 'Pré-rempli avec les coordonnées de votre société. Modifiez si nécessaire.', invoiceRecipient: 'Destinataire de la facture', invoiceRecipientPlaceholder: 'Nom ou raison sociale', poReference: 'Référence bon de commande',
    insuredNameRequired: "Nom de l'assuré *", insuredNamePlaceholder: "ex : SPRL Dupont — Cabinet d'expertise", claimAddress: 'Adresse du sinistre', claimAddressPlaceholder: 'Rue du Marché 10, 1000 Bruxelles', companyRefRequired: 'Référence compagnie *', companyRefOptional: 'Référence compagnie (optionnel)', companyRefPlaceholder: 'Numéro de dossier interne (ex : SIN-2026-1234)',
    claimRefPlaceholder: 'ex : 2026/87234', insuranceCompanyPlaceholder: 'ex : Ethias, AXA, Allianz…', insuranceFieldsHelp: 'Optionnels. Apparaissent sur la fiche du dossier et permettent au technicien de référencer le sinistre auprès de la compagnie.', companyRefHelp: 'La référence compagnie vous permettra de retrouver le dossier dans votre liste et apparaîtra sur les rapports/factures.',
    availabilitiesPageTitle: 'Disponibilités FoxO', calendarSubtitle: 'Cliquez sur un créneau libre pour pré-remplir une demande', reserved: 'Réservé', notifications: 'Notifications', noNotifications: 'Aucune notification', justNow: "à l'instant",
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
    plannedIntervention: 'Geplande interventie', notConfirmed: 'Niet bevestigd', notYetAssigned: 'Nog niet toegewezen', lastUpdate: 'Bijgewerkt',
    yourInternalRef: 'Uw interne referentie', save: 'Opslaan', saving: 'Opslaan…', refSavedMsg: 'Referentie opgeslagen.',
    suspensionReason: 'Reden van opschorting',
    descriptionTitle: 'Beschrijving', interventionType: 'Type interventie', initialDescription: 'Oorspronkelijke beschrijving', apartmentsConcerned: 'Betrokken appartement(en)', aptShort: 'App.', preciseAddress: 'Exact adres',
    reportIsAvailable: 'Het interventierapport is beschikbaar.', downloadReport: 'Rapport downloaden', downloadInvoice: 'Factuur downloaden', reportInPreparation: 'Rapport wordt voorbereid. U wordt verwittigd zodra het beschikbaar is.',
    requestFollowUpTitle: 'Een vervolg vragen', followUpSentMsg: 'Aanvraag verzonden — het FoxO-team is verwittigd en antwoordt u via de berichten hieronder.', followUpIntro: 'Blijft er een probleem of wenst u een nieuw bezoek voor dit dossier? Stuur een vervolgaanvraag: ze wordt doorgegeven aan het FoxO-team en verschijnt in de berichten hieronder.', requestFollowUpButton: 'Een vervolg / herziening vragen', sending: 'Verzenden…', followUpSendError: 'Verzenden van de aanvraag mislukt.', networkError: 'Netwerkfout.',
    insuranceInfo: 'Verzekeringsgegevens', insuranceCompany: 'Verzekeringsmaatschappij', claimReference: 'Schadereferentie', policyReference: 'Polisreferentie', insurerContact: 'Contact verzekeraar', actionRequired: 'Vereiste actie',
    occupantsTitle: 'Bewoners', confirmedSuffix: 'bevestigd', occConfirmed: 'Bevestigd', occPending: 'In afwachting', occDeclined: 'Geweigerd',
    billingTitle: 'Facturatie', recipient: 'Bestemmeling', emailLabel: 'E-mail', purchaseOrder: 'Bestelbon',
    mustBeLinkedToCreate: 'U moet gekoppeld zijn aan een syndicus of makelaar om een aanvraag aan te maken.', contactUsAt: 'Neem contact op via info@foxo.be',
    newRequestTitle: 'Nieuwe interventieaanvraag', assignMissionTitle: 'Een opdracht toevertrouwen', wizardSubtitle: '5 stappen — u kunt op elk moment terugkeren',
    stepClaim: 'Schade', stepProblem: 'Probleem', stepSlot: 'Tijdslot',
    previous: 'Vorige', next: 'Volgende', assignMissionBtn: 'Opdracht toevertrouwen', submitRequestBtn: 'Aanvraag indienen',
    buildingConcerned: 'Betrokken gebouw', selectedSuffix: 'geselecteerd', change: 'Wijzigen',
    searchByNameOrBce: 'Zoeken op naam of KBO-nummer', searchAcpPlaceholder: 'bv. Residentie Bellevue · BE0123.456.789', searchingEllipsis: 'Zoeken…', noAcpFoundFor: 'Geen VME gevonden voor', createNewAcp: 'Nieuwe VME aanmaken', newAcpTitle: 'Nieuwe VME',
    nameRequired: 'Naam *', acpNamePlaceholder: 'Residentie Bellevue', buildingAddress: 'Adres van het gebouw', addressPlaceholder: 'Louizalaan 42, 1050 Brussel', bceNumber: 'KBO-nummer', emailReport: 'E-mail rapport', emailBilling: 'E-mail facturatie', cancel: 'Annuleren', creatingEllipsis: 'Aanmaken…', createAndSelect: 'Aanmaken & selecteren', createError: 'Fout bij het aanmaken.',
    preciseAddressLabel: 'Exact adres van de interventie (indien anders dan de VME)', preciseAddressPlaceholder: 'bv. App 3B, verdieping 5', optionalParen: '(optioneel)',
    problemDescriptionTitle: 'Beschrijving van het probleem', typeRequired: 'Type *', selectPlaceholder: '— Selecteren —', descriptionRequired: 'Beschrijving *', descriptionPlaceholder: 'Beschrijf het probleem, de verdieping, de zichtbare schade…', charactersCount: 'teken(s)', priority: 'Prioriteit', priorityNormal: 'Normaal', priorityUrgent: 'Dringend',
    occupantsConcernedTitle: 'Betrokken bewoners', occupantsHelp: 'Optioneel. Elke bewoner ontvangt een persoonlijke bevestigingslink zodra de aanvraag is gevalideerd.', occupantN: 'Bewoner', remove: 'Verwijderen', nameLabel: 'Naam', phone: 'Telefoon', addOccupant: 'Een bewoner toevoegen',
    slotDesiredTitle: 'Gewenst tijdslot', slotNonContractual: 'Niet-contractueel — FoxO bevestigt binnen 24 werkuren.', slotPreselected: 'Tijdslot vooraf geselecteerd vanuit de kalender', dateLabel: 'Datum', timeLabel: 'Uur', indifferentOption: '— Maakt niet uit —', slotCanLeaveEmpty: 'U kunt dit ook leeg laten — FoxO stelt dan een tijdslot voor.',
    billingPrefilledHelp: 'Vooraf ingevuld met de gegevens van uw bedrijf. Pas aan indien nodig.', invoiceRecipient: 'Bestemmeling van de factuur', invoiceRecipientPlaceholder: 'Naam of bedrijfsnaam', poReference: 'Referentie bestelbon',
    insuredNameRequired: 'Naam van de verzekerde *', insuredNamePlaceholder: 'bv. BVBA Dupont — Expertisekantoor', claimAddress: 'Adres van de schade', claimAddressPlaceholder: 'Marktstraat 10, 1000 Brussel', companyRefRequired: 'Referentie maatschappij *', companyRefOptional: 'Referentie maatschappij (optioneel)', companyRefPlaceholder: 'Intern dossiernummer (bv. SIN-2026-1234)',
    claimRefPlaceholder: 'bv. 2026/87234', insuranceCompanyPlaceholder: 'bv. Ethias, AXA, Allianz…', insuranceFieldsHelp: 'Optioneel. Verschijnen op de dossierfiche en laten de technieker toe de schade bij de maatschappij te refereren.', companyRefHelp: 'Met de referentie van de maatschappij vindt u het dossier terug in uw lijst en verschijnt ze op de rapporten/facturen.',
    availabilitiesPageTitle: 'Beschikbaarheden FoxO', calendarSubtitle: 'Klik op een vrij tijdslot om een aanvraag voor te vullen', reserved: 'Gereserveerd', notifications: 'Meldingen', noNotifications: 'Geen meldingen', justNow: 'zonet',
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
    plannedIntervention: 'Scheduled intervention', notConfirmed: 'Not confirmed', notYetAssigned: 'Not yet assigned', lastUpdate: 'Updated',
    yourInternalRef: 'Your internal reference', save: 'Save', saving: 'Saving…', refSavedMsg: 'Reference saved.',
    suspensionReason: 'Reason for suspension',
    descriptionTitle: 'Description', interventionType: 'Intervention type', initialDescription: 'Initial description', apartmentsConcerned: 'Apartment(s) concerned', aptShort: 'Apt.', preciseAddress: 'Precise address',
    reportIsAvailable: 'The intervention report is available.', downloadReport: 'Download the report', downloadInvoice: 'Download the invoice', reportInPreparation: 'Report being prepared. You will be notified as soon as it is available.',
    requestFollowUpTitle: 'Request a follow-up', followUpSentMsg: 'Request sent — the FoxO team has been notified and will reply via the messages below.', followUpIntro: 'Still having an issue or want another visit for this file? Send a follow-up request: it is forwarded to the FoxO team and appears in the messages below.', requestFollowUpButton: 'Request a follow-up / review', sending: 'Sending…', followUpSendError: 'Failed to send the request.', networkError: 'Network error.',
    insuranceInfo: 'Insurance information', insuranceCompany: 'Insurance company', claimReference: 'Claim reference', policyReference: 'Policy reference', insurerContact: 'Insurer contact', actionRequired: 'Action required',
    occupantsTitle: 'Occupants', confirmedSuffix: 'confirmed', occConfirmed: 'Confirmed', occPending: 'Pending', occDeclined: 'Declined',
    billingTitle: 'Billing', recipient: 'Recipient', emailLabel: 'Email', purchaseOrder: 'Purchase order',
    mustBeLinkedToCreate: 'You must be linked to a property manager or broker to create a request.', contactUsAt: 'Contact us at info@foxo.be',
    newRequestTitle: 'New intervention request', assignMissionTitle: 'Assign a mission', wizardSubtitle: '5 steps — you can go back at any time',
    stepClaim: 'Claim', stepProblem: 'Problem', stepSlot: 'Slot',
    previous: 'Previous', next: 'Next', assignMissionBtn: 'Assign the mission', submitRequestBtn: 'Submit the request',
    buildingConcerned: 'Building concerned', selectedSuffix: 'selected', change: 'Change',
    searchByNameOrBce: 'Search by name or company number', searchAcpPlaceholder: 'e.g. Bellevue Residence · BE0123.456.789', searchingEllipsis: 'Searching…', noAcpFoundFor: 'No co-ownership found for', createNewAcp: 'Create a new co-ownership', newAcpTitle: 'New co-ownership',
    nameRequired: 'Name *', acpNamePlaceholder: 'Bellevue Residence', buildingAddress: 'Building address', addressPlaceholder: 'Avenue Louise 42, 1050 Brussels', bceNumber: 'Company number', emailReport: 'Report email', emailBilling: 'Billing email', cancel: 'Cancel', creatingEllipsis: 'Creating…', createAndSelect: 'Create & select', createError: 'Creation error.',
    preciseAddressLabel: 'Precise address of the intervention (if different from the co-ownership)', preciseAddressPlaceholder: 'e.g. Apt 3B, floor 5', optionalParen: '(optional)',
    problemDescriptionTitle: 'Problem description', typeRequired: 'Type *', selectPlaceholder: '— Select —', descriptionRequired: 'Description *', descriptionPlaceholder: 'Describe the problem, the floor, the visible damage…', charactersCount: 'character(s)', priority: 'Priority', priorityNormal: 'Normal', priorityUrgent: 'Urgent',
    occupantsConcernedTitle: 'Occupants concerned', occupantsHelp: 'Optional. Each will receive a personalised confirmation link once the request is validated.', occupantN: 'Occupant', remove: 'Remove', nameLabel: 'Name', phone: 'Phone', addOccupant: 'Add an occupant',
    slotDesiredTitle: 'Preferred slot', slotNonContractual: 'Non-binding — FoxO will confirm within 24 working hours.', slotPreselected: 'Slot pre-selected from the calendar', dateLabel: 'Date', timeLabel: 'Time', indifferentOption: '— No preference —', slotCanLeaveEmpty: 'You can also leave it empty — FoxO will propose a slot.',
    billingPrefilledHelp: 'Pre-filled with your company details. Edit if necessary.', invoiceRecipient: 'Invoice recipient', invoiceRecipientPlaceholder: 'Name or company name', poReference: 'Purchase order reference',
    insuredNameRequired: "Insured's name *", insuredNamePlaceholder: 'e.g. Dupont Ltd — Expert firm', claimAddress: 'Claim address', claimAddressPlaceholder: 'Rue du Marché 10, 1000 Brussels', companyRefRequired: 'Company reference *', companyRefOptional: 'Company reference (optional)', companyRefPlaceholder: 'Internal file number (e.g. SIN-2026-1234)',
    claimRefPlaceholder: 'e.g. 2026/87234', insuranceCompanyPlaceholder: 'e.g. Ethias, AXA, Allianz…', insuranceFieldsHelp: 'Optional. They appear on the file and let the technician reference the claim with the company.', companyRefHelp: 'The company reference lets you find the file in your list and appears on reports/invoices.',
    availabilitiesPageTitle: 'FoxO availability', calendarSubtitle: 'Click a free slot to pre-fill a request', reserved: 'Reserved', notifications: 'Notifications', noNotifications: 'No notifications', justNow: 'just now',
  },
};

export function tFor(lang: Lang) {
  return (key: PortalStringKey): string =>
    STRINGS[lang]?.[key] ?? STRINGS[DEFAULT_LANG][key] ?? key;
}

// Libelles d'affichage des TYPES d'intervention (valeurs DB en FR conservees,
// seul l'affichage est traduit). Fallback = la valeur elle-meme.
// NOTE: traductions NL/EN generees par Claude — A FAIRE RELIRE par un natif NL.
const TYPE_LABEL: Record<Lang, Record<string, string>> = {
  fr: { 'Fuite canalisation': 'Fuite canalisation', 'Fuite chauffage': 'Fuite chauffage', 'Fuite infiltration': 'Fuite infiltration', 'Surconsommation eau': 'Surconsommation eau', 'Autre': 'Autre' },
  nl: { 'Fuite canalisation': 'Leidinglek', 'Fuite chauffage': 'Verwarmingslek', 'Fuite infiltration': 'Infiltratie', 'Surconsommation eau': 'Overmatig waterverbruik', 'Autre': 'Andere' },
  en: { 'Fuite canalisation': 'Pipe leak', 'Fuite chauffage': 'Heating leak', 'Fuite infiltration': 'Infiltration', 'Surconsommation eau': 'Excess water consumption', 'Autre': 'Other' },
};

export function typeLabel(value: string, lang: Lang): string {
  return TYPE_LABEL[lang]?.[value] ?? value;
}
