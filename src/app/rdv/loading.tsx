import { Skeleton } from '@/components/ui/Skeleton';

// Squelette de la page publique /rdv, affiché pendant le chargement serveur
// des disponibilités (2 mois de créneaux). Silhouette : bandeau, calendrier,
// bloc formulaire.
export default function RdvLoading() {
  return (
    <div className="px-4 sm:px-6 py-8 sm:py-10 max-w-[1100px] mx-auto w-full space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-64 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-[280px] w-full rounded-card" />
      <div className="bg-[var(--color-cream)] rounded-card p-5 sm:p-7 space-y-3" style={{ boxShadow: 'var(--shadow-card)' }}>
        <Skeleton className="h-5 w-48" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
