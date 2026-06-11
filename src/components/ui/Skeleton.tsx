// Skeleton D7 — placeholder de chargement sobre (sand-mid, pulse discret,
// cf. .fx-skeleton dans globals.css). À brancher uniquement sur des états
// de chargement existants : il remplace les textes « Chargement… », il ne
// crée pas de nouveau fetch.

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return <div aria-hidden="true" className={`fx-skeleton ${className}`} />;
}

interface SkeletonTextProps {
  /** Nombre de lignes simulées (la dernière est raccourcie). */
  lines?: number;
  className?: string;
}

export function SkeletonText({ lines = 3, className = '' }: SkeletonTextProps) {
  return (
    <div aria-hidden="true" className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={i === lines - 1 ? 'h-3 w-3/5' : 'h-3 w-full'} />
      ))}
    </div>
  );
}
