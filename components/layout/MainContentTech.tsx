// MainContentTech — variante mobile-first du MainContent FoxO pour le
// portail tech.foxo.be. Contraintes spécifiques :
// - max-w-[640px] centré (lecture tactile confortable sur tablette/mobile)
// - padding-bottom safe-area pour la TechBottomNav iOS-style (90px réservé)
// - Top spacing pour le TechHeader sticky 64px (le header est sibling, donc
//   pas de padding-top dédié — le sticky se superpose proprement)
// - Background sand FoxO + un seul radial gradient sky-foxo top-center
//   (sobriété sur petit écran vs les 2 gradients du MainContent admin)
// - Padding interne 16px sur les côtés (vs 24px en admin) pour maximiser
//   la surface de lecture et les cibles tactiles
//
// ⚠ NE PAS modifier le TechHeader ni la TechBottomNav (chrome navigation
// du portail tech). Ce composant doit être placé EN SIBLING des nav, jamais
// en wrapper.
//
// Usage typique dans tech/layout.tsx :
//   <div className="min-h-screen flex flex-col">
//     <TechHeader sticky 64px />
//     <MainContentTech>{children}</MainContentTech>
//     <TechBottomNav fixed safe-area />
//   </div>

export function MainContentTech({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <main
      className={`mx-auto w-full max-w-[640px] flex-1 ${className}`}
      style={{
        background: 'var(--color-sand)',
        backgroundImage:
          'radial-gradient(circle at 50% 0%, rgba(168, 212, 232, 0.12) 0%, transparent 60%)',
        minHeight: '100vh',
        paddingTop: '16px',
        paddingBottom: 'calc(90px + env(safe-area-inset-bottom, 0px))',
        paddingLeft: '16px',
        paddingRight: '16px',
      }}
    >
      {children}
    </main>
  );
}
