// MainContent — wrapper standard des zones "main content" du Design
// System FoxO (cf. FOXO_DESIGN_SYSTEM_PROMPT.md, Phase 0).
//
// Pose le background sand + 2 radial-gradients signature (sky-foxo top-left
// + terra-mid bottom-right) qui donnent l'identité visuelle premium navy
// chaude commune à admin / portal / rdv.
//
// ⚠ NE PAS toucher aux sidebars : ce composant doit être placé en
// sibling de la <Sidebar /> dans chaque layout, jamais en wrapper.
//
// Usage typique :
//   <div className="flex min-h-screen">
//     <Sidebar />
//     <MainContent className="flex-1">{children}</MainContent>
//   </div>

export function MainContent({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <main
      className={`min-h-screen ${className}`}
      style={{
        background: 'var(--color-sand)',
        backgroundImage:
          'radial-gradient(circle at 12% -5%, rgba(168, 212, 232, 0.18) 0%, transparent 45%), radial-gradient(circle at 95% 100%, rgba(196, 98, 45, 0.05) 0%, transparent 45%)',
      }}
    >
      <div className="px-6 py-6">{children}</div>
    </main>
  );
}
