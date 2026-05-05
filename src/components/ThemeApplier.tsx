'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { themes, portalDefaults, type ThemeKey } from '@/lib/themes';

const STORAGE_KEY = 'foxo-theme-v2';
const CHANGE_EVENT = 'foxo-theme-change';

const THEME_KEYS: ThemeKey[] = ['dark-amber', 'warm-light', 'foxo-blue'];

function isThemeKey(s: string | null | undefined): s is ThemeKey {
  return typeof s === 'string' && (THEME_KEYS as string[]).includes(s);
}

// Convertit 'sidebarText' → '--sidebar-text' (camelCase → kebab CSS var).
function toCssVar(k: string): string {
  return '--' + k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
}

// Détecte le portail courant à partir du pathname pour récupérer le
// thème par défaut depuis portalDefaults.
function detectPortal(pathname: string): keyof typeof portalDefaults {
  if (pathname.startsWith('/tech')) return 'tech';
  if (pathname.startsWith('/portal')) return 'portal';
  return 'admin';
}

// Applique toutes les CSS vars d'un thème sur <html> + alias compat
// pour les anciennes vars (--sidebar-bg, etc.) utilisées dans Sidebar
// et dans globals.css.
export function applyTheme(themeKey: ThemeKey): void {
  if (typeof document === 'undefined') return;
  const t = themes[themeKey];
  const root = document.documentElement;
  for (const k of Object.keys(t) as Array<keyof typeof t>) {
    if (k === 'name') continue;
    root.style.setProperty(toCssVar(k as string), t[k] as string);
  }
  // Compat avec les vars historiques utilisées par Sidebar.tsx /
  // globals.css (--sidebar-bg, --sidebar-fg, --sidebar-logo-bg,
  // --sidebar-logo-fg). Tant que Sidebar n'est pas migré sur les
  // nouvelles vars (--sidebar / --sidebar-text / --sidebar-label),
  // on alias pour éviter une régression visuelle.
  root.style.setProperty('--sidebar-bg', t.sidebar);
  root.style.setProperty('--sidebar-fg', t.sidebarText);
  root.style.setProperty('--sidebar-logo-bg', t.sidebar);
  root.style.setProperty('--sidebar-logo-fg', t.sidebarLabel);
  root.dataset.theme = themeKey;
}

// API publique : change + persiste + broadcast aux autres composants
// qui écoutent (ThemeSelector / ThemeToggle).
export function setTheme(themeKey: ThemeKey): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, themeKey);
  } catch {
    /* noop : Safari private mode, etc. */
  }
  applyTheme(themeKey);
  window.dispatchEvent(new CustomEvent<ThemeKey>(CHANGE_EVENT, { detail: themeKey }));
}

export function getCurrentTheme(): ThemeKey {
  if (typeof document === 'undefined') return 'dark-amber';
  const ds = document.documentElement.dataset.theme;
  if (isThemeKey(ds)) return ds;
  return 'dark-amber';
}

// Hook listener pour les composants qui veulent réagir à un changement
// de thème en provenance d'ailleurs (ex: ThemeSelector dans la sidebar
// qui doit rafraîchir si le ThemeToggle mobile change le thème).
export function subscribeThemeChange(cb: (k: ThemeKey) => void): () => void {
  function handler(e: Event) {
    const detail = (e as CustomEvent<ThemeKey>).detail;
    if (isThemeKey(detail)) cb(detail);
  }
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

// Composant invisible — réapplique le thème par défaut du portail au
// changement de path (ex: l'utilisateur navigue de /admin vers /tech).
// L'init initial est fait par le script blocking du <head> dans
// app/layout.tsx (évite le FOUC).
export function ThemeApplier() {
  const pathname = usePathname();

  useEffect(() => {
    let theme: ThemeKey | null = null;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isThemeKey(stored)) theme = stored;
    } catch { /* noop */ }
    if (!theme) {
      const portal = detectPortal(pathname);
      theme = portalDefaults[portal];
    }
    applyTheme(theme);
  }, [pathname]);

  return null;
}

// Script blocking à injecter dans <head> via dangerouslySetInnerHTML
// pour appliquer les CSS vars avant le 1er paint et éviter le FOUC.
// Inline le mapping themes pour ne pas dépendre d'un module à charger.
export const THEME_INIT_SCRIPT = `(function(){
  try {
    var themes = ${JSON.stringify(themes)};
    var defaults = ${JSON.stringify(portalDefaults)};
    var path = window.location.pathname;
    var portal = path.indexOf('/tech') === 0 ? 'tech'
               : path.indexOf('/portal') === 0 ? 'portal'
               : 'admin';
    var stored = null;
    try { stored = localStorage.getItem('${STORAGE_KEY}'); } catch (e) {}
    var keys = ['dark-amber','warm-light','foxo-blue'];
    var theme = (stored && keys.indexOf(stored) !== -1) ? stored : defaults[portal];
    var t = themes[theme];
    var r = document.documentElement;
    for (var k in t) {
      if (k === 'name') continue;
      var cssVar = '--' + k.replace(/[A-Z]/g, function(m){return '-'+m.toLowerCase();});
      r.style.setProperty(cssVar, t[k]);
    }
    r.style.setProperty('--sidebar-bg', t.sidebar);
    r.style.setProperty('--sidebar-fg', t.sidebarText);
    r.style.setProperty('--sidebar-logo-bg', t.sidebar);
    r.style.setProperty('--sidebar-logo-fg', t.sidebarLabel);
    r.dataset.theme = theme;
  } catch (e) {}
})();`;
