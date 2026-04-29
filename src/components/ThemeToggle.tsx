'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

// Bascule clair/sombre. resolvedTheme = thème effectif (résout 'system').
// Pour éviter l'hydration mismatch, on rend un placeholder tant que pas monté.
//
// `withLabel` : affiche "☀️ Thème clair" / "🌙 Thème sombre" au lieu de l'icône
// seule. À utiliser dans la sidebar desktop / les en-têtes où l'on a la place.
export function ThemeToggle({
  className,
  inline = false,
  withLabel = false,
}: {
  className?: string;
  inline?: boolean;
  withLabel?: boolean;
}) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // 4 thèmes : ce toggle bascule entre Sable et Nuit (les 2 défauts).
  // Pour Ocean/Ardoise, l'utilisateur passe par le sélecteur 4 thèmes
  // dans la sidebar admin.
  const isDark = theme === 'nuit' || theme === 'ardoise';

  function toggle() {
    const next = isDark ? 'sable' : 'nuit';
    document.documentElement.classList.add('theme-transitioning');
    setTheme(next);
    window.setTimeout(() => {
      document.documentElement.classList.remove('theme-transitioning');
    }, 220);
  }

  // Rendu placeholder en SSR + premier rendu client pour éviter mismatch
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

  const ariaLabel = isDark ? 'Passer au thème clair' : 'Passer au thème sombre';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={className}
    >
      {withLabel ? (
        <>
          <span style={{ marginRight: 6 }}>{isDark ? '☀️' : '🌙'}</span>
          <span>{isDark ? 'Mode clair' : 'Mode sombre'}</span>
        </>
      ) : (
        isDark ? '☀️' : '🌙'
      )}
    </button>
  );
}
