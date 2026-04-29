'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

// 4 thèmes sélectionnables. Chaque entrée :
//   - name   : valeur stockée dans localStorage 'foxo-theme'
//   - label  : libellé visible
//   - colorA : couleur de la moitié gauche du cercle (clair = surface)
//   - colorB : couleur de la moitié droite du cercle (foncé = primaire)
const THEMES = [
  { name: 'sable',   label: 'Sable',   colorA: '#FDFBF7', colorB: '#1B3A6B' },
  { name: 'nuit',    label: 'Nuit',    colorA: '#1a1a1a', colorB: '#A17244' },
  { name: 'ocean',   label: 'Océan',   colorA: '#f5f8fa', colorB: '#156082' },
  { name: 'ardoise', label: 'Ardoise', colorA: '#2b2b2b', colorB: '#156082' },
] as const;

type ThemeName = typeof THEMES[number]['name'];

export function ThemeSelector({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  function pick(name: ThemeName) {
    document.documentElement.classList.add('theme-transitioning');
    setTheme(name);
    window.setTimeout(() => {
      document.documentElement.classList.remove('theme-transitioning');
    }, 220);
  }

  // Avant montage côté client : ne rien afficher (évite le mismatch SSR)
  if (!mounted) {
    return <div className={className} style={{ minHeight: 56 }} aria-hidden />;
  }

  const current = (theme ?? 'sable') as string;

  return (
    <div className={className} role="radiogroup" aria-label="Sélection du thème">
      <div style={{ display: 'flex', gap: 4 }}>
        {THEMES.map((t) => {
          const active = current === t.name;
          return (
            <button
              key={t.name}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={t.label}
              title={t.label}
              onClick={() => pick(t.name)}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                padding: '6px 4px',
                background: active ? 'rgba(226,201,161,.12)' : 'transparent',
                border: active ? '2px solid #E2C9A1' : '2px solid rgba(255,255,255,.08)',
                borderRadius: 8,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'background-color .15s, border-color .15s',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  border: '1px solid rgba(0,0,0,.25)',
                  // Diagonale : moitié gauche colorA, droite colorB
                  background: `linear-gradient(135deg, ${t.colorA} 0%, ${t.colorA} 50%, ${t.colorB} 50%, ${t.colorB} 100%)`,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 9,
                  color: active ? '#E2C9A1' : '#C8C2B8',
                  fontWeight: 700,
                  letterSpacing: 0.3,
                }}
              >
                {t.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
