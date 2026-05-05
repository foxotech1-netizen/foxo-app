'use client';

import { useEffect, useState } from 'react';
import { themes, type ThemeKey } from '@/lib/themes';
import { getCurrentTheme, setTheme, subscribeThemeChange } from './ThemeApplier';

// Sélecteur de thème — 3 options (dark-amber / warm-light / foxo-blue)
// pilotées par le système themes.ts. Utilisé dans la sidebar admin.
//
// Pas d'hydration mismatch : on initialise le state à 'dark-amber' (SSR
// neutre) puis on synchronise au mount via getCurrentTheme().
export function ThemeSelector({ className }: { className?: string }) {
  const [current, setCurrent] = useState<ThemeKey>('dark-amber');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setCurrent(getCurrentTheme());
    return subscribeThemeChange(setCurrent);
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value as ThemeKey;
    setTheme(v);
    setCurrent(v);
  }

  return (
    <select
      value={mounted ? current : 'dark-amber'}
      onChange={handleChange}
      className={className}
      aria-label="Thème"
      style={{
        width: '100%',
        height: 32,
        borderRadius: 7,
        background: 'rgba(255,255,255,.06)',
        border: '1px solid rgba(255,255,255,.1)',
        color: '#C8C2B8',
        fontSize: 11,
        fontWeight: 600,
        padding: '0 8px',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {(Object.keys(themes) as ThemeKey[]).map((k) => (
        <option key={k} value={k}>{themes[k].name}</option>
      ))}
    </select>
  );
}
