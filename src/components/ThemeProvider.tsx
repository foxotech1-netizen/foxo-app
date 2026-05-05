// ─── Stub de compat post-migration vers le nouveau système de thèmes ─
//
// L'ancien provider basé sur `next-themes` (4 thèmes : sable / nuit /
// ocean / ardoise pilotés via classes CSS sur <html>) a été remplacé
// par le système themes.ts (3 thèmes : dark-amber / warm-light /
// foxo-blue, pilotés via CSS vars injectées sur <html>). Le bootstrap
// se fait désormais dans `src/app/layout.tsx` (script blocking +
// composant ThemeApplier).
//
// Ce fichier reste comme passthrough pour ne pas casser les imports
// existants — à supprimer une fois certain que plus rien ne l'utilise.

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
