// i18n portail FoxO — moteur multi-langues, extensible.
// Ajouter une langue = ajouter son code ci-dessous + fournir les traductions
// (vocab.ts + STRINGS). Tout texte manquant retombe automatiquement sur le FR.
// NOTE: traductions NL/EN generees par Claude — A FAIRE RELIRE par un natif (NL surtout).

export type Lang = 'fr' | 'nl' | 'en';

// Langues proposees dans la bascule. Ordre = ordre d'affichage.
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

// Chaines UI generales (hors libelles lies au type d'org, qui sont dans vocab.ts).
// On ajoute des cles ici au fil des ecrans traduits (phases suivantes).
export type PortalStringKey = 'home' | 'dashboard' | 'planning' | 'newShort' | 'logout';

const STRINGS: Record<Lang, Record<PortalStringKey, string>> = {
  fr: { home: 'Accueil', dashboard: 'Tableau de bord', planning: 'Planning', newShort: 'Nouveau', logout: 'Déconnexion' },
  nl: { home: 'Start', dashboard: 'Dashboard', planning: 'Planning', newShort: 'Nieuw', logout: 'Afmelden' },
  en: { home: 'Home', dashboard: 'Dashboard', planning: 'Schedule', newShort: 'New', logout: 'Log out' },
};

// Retourne une fonction de traduction liee a la langue : t('key') avec repli FR.
export function tFor(lang: Lang) {
  return (key: PortalStringKey): string =>
    STRINGS[lang]?.[key] ?? STRINGS[DEFAULT_LANG][key] ?? key;
}
