export type ThemeKey = 'dark-amber' | 'warm-light' | 'foxo-blue';

export const themes = {
  'dark-amber': {
    name: 'Sombre Amber',
    // Si la sidebar du thème est sombre, le composant <Logo /> sélectionne
    // automatiquement la variante 'blanc' (cf. components/Sidebar.tsx :
    // logoVariant = sidebarDark ? 'blanc' : 'noir'). Future-proof : un
    // thème à sidebar claire mettra `sidebarDark: false` et utilisera
    // la variante 'noir' par défaut.
    sidebarDark: true,
    // Hero banner /admin/home — bandeau qui surplombe la grille de
    // modules. warm-light garde le sable d'origine ; les autres thèmes
    // l'ajustent à leur palette pour rester cohérents.
    heroBg: 'rgba(200,146,74,0.15)',
    sidebar: '#1A1916',
    sidebarText: '#9A9690',
    sidebarActive: 'rgba(200,146,74,0.15)',
    sidebarActiveText: '#DBA96A',
    sidebarLabel: '#4A4845',
    sidebarHover: '#2E2C28',
    accent: '#C8924A',
    accentDim: 'rgba(200,146,74,0.15)',
    // --info-bg / --info-fg : couleur sémantique "information / pending"
    // (ex. banner "vous avez proposé un autre créneau"). Découplée de
    // l'accent du thème pour rester un bleu doux quel que soit le
    // thème — un orange "info" perturberait la lecture.
    infoBg: 'rgba(59,130,196,0.10)',
    infoFg: '#3B82C4',
    mainBg: '#F7F5F2',
    topBg: '#FFFFFF',
    topBorder: '#E6E2DC',
    cardBg: '#FFFFFF',
    cardBorder: '#E6E2DC',
    cardBorder2: '#EFECE8',
    tableBg: '#F7F5F2',
    text: '#1A1916',
    text2: '#3D3A34',
    text3: '#6B6760',
    btnBg: '#1A1916',
    btnColor: '#ffffff',
    filterActive: '#1A1916',
  },
  'warm-light': {
    name: 'Clair Warm',
    sidebarDark: true,
    heroBg: '#E2C9A1',
    sidebar: '#2C2118',
    sidebarText: '#9A8A7A',
    sidebarActive: 'rgba(232,160,80,0.15)',
    sidebarActiveText: '#E8C090',
    sidebarLabel: '#5A4A3A',
    sidebarHover: '#3A2B1F',
    accent: '#D4862A',
    accentDim: 'rgba(212,134,42,0.12)',
    infoBg: 'rgba(59,130,196,0.10)',
    infoFg: '#3B82C4',
    mainBg: '#FAF7F2',
    topBg: '#FFFDF9',
    topBorder: '#EDE5D8',
    cardBg: '#FFFDF9',
    cardBorder: '#EDE5D8',
    cardBorder2: '#F5EFE4',
    tableBg: '#FAF7F2',
    text: '#2C1A0A',
    text2: '#4A3020',
    text3: '#8A7060',
    btnBg: '#2C1A0A',
    btnColor: '#ffffff',
    filterActive: '#2C1A0A',
  },
  'foxo-blue': {
    name: 'Bleu FoxO',
    sidebarDark: true,
    heroBg: 'rgba(59,114,176,0.10)',
    sidebar: '#1B3A5C',
    sidebarText: '#7A9EC0',
    sidebarActive: 'rgba(59,114,176,0.22)',
    sidebarActiveText: '#A8CCF0',
    sidebarLabel: '#3A5E80',
    sidebarHover: 'rgba(255,255,255,0.06)',
    accent: '#E8A020',
    accentDim: 'rgba(232,160,32,0.12)',
    infoBg: 'rgba(59,114,176,0.10)',
    infoFg: '#3B72B0',
    mainBg: '#F4F7FB',
    topBg: '#FFFFFF',
    topBorder: '#D0DFF0',
    cardBg: '#FFFFFF',
    cardBorder: '#D0DFF0',
    cardBorder2: '#E8EFF8',
    tableBg: '#F4F7FB',
    text: '#1B3A5C',
    text2: '#2C4A6A',
    text3: '#6A90B8',
    btnBg: '#3B72B0',
    btnColor: '#ffffff',
    filterActive: '#3B72B0',
  },
} as const;

export const portalDefaults: Record<string, ThemeKey> = {
  'admin': 'dark-amber',
  'tech':  'warm-light',
  'portal': 'foxo-blue',
};
