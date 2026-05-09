'use client';

import { useEffect, useState } from 'react';

// Hook responsive — wrappe window.matchMedia avec listener change.
//
// Usage :
//   const isMobile   = useMediaQuery('(max-width: 767px)');
//   const isTabletUp = useMediaQuery('(min-width: 768px)');
//   const isDesktop  = useMediaQuery('(min-width: 1024px)');
//
// SSR-safe : retourne `false` au premier render (côté serveur), puis
// synchronise au mount. Si tu rends du contenu conditionnel important
// pour le SEO ou pour éviter un layout shift, préfère les classes
// Tailwind responsives (hidden / sm:block / md:hidden) qui fonctionnent
// sans JS.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia(query);
    setMatches(media.matches);
    const listener = (e: MediaQueryListEvent) => setMatches(e.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [query]);

  return matches;
}
