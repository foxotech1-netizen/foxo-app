import { STATUT_INFO, type StatutIntervention } from '@/lib/types/database';

export function StatutBadge({
  statut,
  big = false,
}: {
  statut: StatutIntervention;
  big?: boolean;
}) {
  const info = STATUT_INFO[statut];
  return (
    <span
      className="inline-block rounded-full font-semibold whitespace-nowrap"
      style={{
        color: info.fg,
        background: info.bg,
        fontSize: big ? 12 : 11,
        padding: big ? '4px 12px' : '3px 9px',
      }}
    >
      {info.label}
    </span>
  );
}
