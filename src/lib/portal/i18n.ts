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

// Locale BCP-47 pour le formatage des dates selon la langue.
export function localeFor(lang: Lang): string {
  return lang === 'nl' ? 'nl-BE' : lang === 'en' ? 'en-GB' : 'fr-BE';
}

// Chaines UI generales (hors libelles lies au type d'org, qui sont dans vocab.ts).
export type PortalStringKey =
  | 'home' | 'dashboard' | 'planning' | 'newShort' | 'logout'
  | 'greeting' | 'statInProgress' | 'statPending' | 'statReportsAvailable' | 'statClosed'
  | 'reportsBannerSuffix' | 'nextAppointment' | 'see' | 'createFirst' | 'typeUnspecified'
  | 'availabilitiesTitle' | 'noSlots' | 'available'
  | 'accountNotLinkedTitle' | 'accountNotLinkedBody';

const STRINGS: Record<Lang, Record<PortalStringKey, string>> = {
  fr: {
    home: 'Accueil', dashboard: 'Tableau de bord', planning: 'Planning', newShort: 'Nouveau', logout: 'Déconnexion',
    greeting: 'Bonjour', statInProgress: 'En cours', statPending: 'En attente', statReportsAvailable: 'Rapports dispo.', statClosed: 'Clôturées',
    reportsBannerSuffix: 'rapport(s) disponible(s) — consulter', nextAppointment: 'Prochain RDV', see: 'Voir', createFirst: 'Créer le premier', typeUnspecified: 'Type non précisé',
    availabilitiesTitle: 'Prochaines disponibilités FoxO', noSlots: 'Aucun créneau libre sur les 14 prochains jours.', available: 'Disponible',
    accountNotLinkedTitle: 'Compte non lié',
    accountNotLinkedBody: "Cette adresse n'est pas encore associée à un syndic, un courtier ou un expert dans nos fichiers. Contactez-nous pour finaliser l'ouverture de votre compte.",
  },
  nl: {
    home: 'Start', dashboard: 'Dashboard', planning: 'Planning', newShort: 'Nieuw', logout: 'Afmelden',
    greeting: 'Hallo', statInProgress: 'Lopend', statPending: 'In afwachting', statReportsAvailable: 'Rapporten besch.', statClosed: 'Afgesloten',
    reportsBannerSuffix: 'rapport(en) beschikbaar — bekijken', nextAppointment: 'Volgende afspraak', see: 'Bekijken', createFirst: 'Maak de eerste aan', typeUnspecified: 'Type niet opgegeven',
    availabilitiesTitle: 'Eerstvolgende beschikbaarheden FoxO', noSlots: 'Geen vrije momenten in de komende 14 dagen.', available: 'Beschikbaar',
    accountNotLinkedTitle: 'Account niet gekoppeld',
    accountNotLinkedBody: 'Dit adres is nog niet gekoppeld aan een syndicus, makelaar of expert in onze bestanden. Neem contact met ons op om uw account te activeren.',
  },
  en: {
    home: 'Home', dashboard: 'Dashboard', planning: 'Schedule', newShort: 'New', logout: 'Log out',
    greeting: 'Hello', statInProgress: 'In progress', statPending: 'Pending', statReportsAvailable: 'Reports avail.', statClosed: 'Closed',
    reportsBannerSuffix: 'report(s) available — view', nextAppointment: 'Next appointment', see: 'View', createFirst: 'Create the first one', typeUnspecified: 'Type not specified',
    availabilitiesTitle: 'Next FoxO availability', noSlots: 'No free slots in the next 14 days.', available: 'Available',
    accountNotLinkedTitle: 'Account not linked',
    accountNotLinkedBody: 'This address is not yet linked to a property manager, broker or expert in our records. Contact us to finalise your account setup.',
  },
};

export function tFor(lang: Lang) {
  return (key: PortalStringKey): string =>
    STRINGS[lang]?.[key] ?? STRINGS[DEFAULT_LANG][key] ?? key;
}
