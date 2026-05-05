'use client';

import { useEffect, useState } from 'react';
import { themes, type ThemeKey } from '@/lib/themes';
import { getCurrentTheme, setTheme, subscribeThemeChange } from './ThemeApplier';

const ORDER: ThemeKey[] = ['dark-amber', 'warm-light', 'foxo-blue'];

const ICON: Record<ThemeKey, string> = {
  'dark-amber': '🌙',
  'warm-light': '☀️',
  'foxo-blue':  '🌊',
};

const SHORT_LABEL: Record<ThemeKey, string> = {
  'dark-amber': 'Sombre',
  'warm-light': 'Clair',
  'foxo-blue':  'Bleu',
};

// Bouton compact qui cycle entre les 3 thèmes au clic. Utilisé dans la
// bannière mobile (header tech, header portal) là où on n'a pas la
// place du sélecteur complet.
//
// Props héritées de l'ancienne API next-themes pour ne pas casser les
// callers (Sidebar.tsx, PortalNav.tsx, tech/layout.tsx) :
//   - className : classes Tailwind/CSS pour le bouton
//   - inline    : si true, ne fixe pas width/height (place libre)
//   - withLabel : affiche "{icon} {label}" au lieu de l'icône seule
export function ThemeToggle({
  className,
  inline = false,
  withLabel = false,
}: {
  className?: string;
  inline?: boolean;
  withLabel?: boolean;
}) {
  const [current, setCurrent] = useState<ThemeKey>('dark-amber');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setCurrent(getCurrentTheme());
    return subscribeThemeChange(setCurrent);
  }, []);

  function cycle() {
    const idx = ORDER.indexOf(current);
    const next = ORDER[(idx + 1) % ORDER.length];
    setTheme(next);
    setCurrent(next);
  }

  // Placeholder pendant l'hydratation pour éviter le mismatch SSR.
  if (!mounted) {
    return (
      <button
        type="button"
        aria-label="Thème"
        className={className}
        style={inline ? undefined : { width: 32, height: 32 }}
      >
        {withLabel ? <span style={{ opacity: 0.5 }}>· · ·</span> : null}
      </button>
    );
  }

  const ariaLabel = `Thème actuel : ${themes[current].name}. Cliquer pour changer.`;
  const icon = ICON[current];

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={className}
    >
      {withLabel ? (
        <>
          <span style={{ marginRight: 6 }}>{icon}</span>
          <span>{SHORT_LABEL[current]}</span>
        </>
      ) : (
        icon
      )}
    </button>
  );
}
