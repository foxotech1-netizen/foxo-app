'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

// Icône bascule. resolvedTheme = thème effectif (résout 'system').
// Pour éviter l'hydration mismatch, on rend le bouton vide tant que pas monté.
export function ThemeToggle({
  className,
  inline = false,
}: {
  className?: string;
  inline?: boolean;
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  function toggle() {
    const next = resolvedTheme === 'dark' ? 'light' : 'dark';
    // Active la transition globale 200ms uniquement pendant le switch
    document.documentElement.classList.add('theme-transitioning');
    setTheme(next);
    window.setTimeout(() => {
      document.documentElement.classList.remove('theme-transitioning');
    }, 220);
  }

  // Rendu vide en SSR + premier rendu client pour éviter mismatch
  if (!mounted) {
    return (
      <button
        aria-label="Thème"
        className={className}
        style={inline ? undefined : { width: 32, height: 32 }}
      />
    );
  }

  const isDark = resolvedTheme === 'dark';
  const label = isDark ? 'Passer au thème clair' : 'Passer au thème sombre';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={className}
    >
      {isDark ? '☀️' : '🌙'}
    </button>
  );
}
