// AdaptiveSection — wrapper visibilité responsive via classes Tailwind.
// Préfère les classes (pas de flash JS au mount, SSR-friendly) plutôt
// qu'un useMediaQuery. Pour les cas où le contenu lui-même change selon
// breakpoint (pas juste afficher/cacher), utilise plutôt useMediaQuery
// directement dans le composant parent.
//
// Breakpoints alignés sur Tailwind défaut :
//   mobile      : <768px       (sm: cassure)
//   tablet      : 768–1023px   (sm:* + max-md)
//   desktop     : ≥1024px      (lg:*)
//   tablet-up   : ≥768px
//   desktop-only: ≥1024px (alias de 'desktop')
//   always      : visible partout

export function AdaptiveSection({
  children,
  showOn,
  className = '',
}: {
  children: React.ReactNode;
  showOn: 'mobile' | 'tablet' | 'desktop' | 'tablet-up' | 'desktop-only' | 'always';
  className?: string;
}) {
  const visibilityCls = (() => {
    switch (showOn) {
      case 'mobile':       return 'block md:hidden';
      case 'tablet':       return 'hidden md:block lg:hidden';
      case 'desktop':
      case 'desktop-only': return 'hidden lg:block';
      case 'tablet-up':    return 'hidden md:block';
      case 'always':
      default:             return '';
    }
  })();
  return <div className={`${visibilityCls} ${className}`.trim()}>{children}</div>;
}
