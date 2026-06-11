import { Skeleton } from '@/components/ui/Skeleton';

// Skeleton de route du back-office admin (D7) — affiché par le boundary
// Suspense de Next pendant le rendu serveur des pages /admin/* (dashboard,
// liste des interventions, mails…). Silhouette générique : en-tête de
// page, bandeau KPI, bloc liste dense.
export default function AdminLoading() {
  return (
    <div className="px-4 py-4 space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-3 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[72px] rounded-card" />
        ))}
      </div>
      <div className="fxs-card p-4 space-y-3">
        <Skeleton className="h-4 w-44" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    </div>
  );
}
