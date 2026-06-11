'use client';

// NextMissions — liste condensée des missions du jour pour le Tableau
// de bord adaptive.
//
// Réutilise les InterventionRow déjà fetchées par admin/page.tsx (server
// component) — pas de re-fetch côté client. Le tri / filtrage est fait
// par le composant Dashboard parent.

import Link from 'next/link';
import type { InterventionRow } from '@/lib/types/database';
import { fmtTime } from '@/lib/format';

const TECH_DOT_COLORS = [
  'var(--color-amber-foxo)',
  'var(--color-navy)',
  'var(--color-ok)',
  'var(--color-terra)',
];

function techDotColor(techId: string | null): string {
  if (!techId) return 'var(--color-ink-muted)';
  // Hash léger sur l'UUID pour assigner une couleur stable.
  let h = 0;
  for (let i = 0; i < techId.length; i++) h = (h * 31 + techId.charCodeAt(i)) >>> 0;
  return TECH_DOT_COLORS[h % TECH_DOT_COLORS.length];
}

interface NextMissionsProps {
  missions: InterventionRow[];
  limit?: number;
  onOpenIntervention?: (id: string) => void;
}

export function NextMissions({ missions, limit = 10, onOpenIntervention }: NextMissionsProps) {
  const visible = missions.slice(0, limit);
  const overflow = Math.max(0, missions.length - limit);

  return (
    <div
      className="rounded-card overflow-hidden"
      style={{
        background: 'var(--color-cream)',
        boxShadow:
          '0 1px 2px rgba(15,32,64,0.04), 0 4px 12px rgba(15,32,64,0.05), 0 0 0 1px rgba(15,32,64,0.04)',
      }}
    >
      {/* Panel head — swatch navy + titre + badge count */}
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-[var(--color-sand-mid)]">
        <span
          className="inline-block rounded-sm"
          style={{ width: 3, height: 14, background: 'var(--color-navy)' }}
          aria-hidden
        />
        <h3 className="font-sora text-[13px] font-medium text-[var(--color-ink)] flex-1 m-0">
          Missions aujourd&apos;hui
        </h3>
        <span
          className="font-sora text-[11px] font-semibold px-2 py-0.5 rounded-full"
          style={{ background: 'var(--color-navy-pale)', color: 'var(--color-navy)' }}
        >
          {missions.length}
        </span>
      </div>

      {/* Liste */}
      <div>
        {visible.length === 0 ? (
          <p className="text-[12px] text-[var(--color-ink-muted)] text-center py-5 m-0">
            Aucune mission prévue aujourd&apos;hui.
          </p>
        ) : (
          <ul className="m-0 p-0 list-none divide-y divide-[var(--color-sand-mid)]">
            {visible.map((iv) => {
              const time = fmtTime(iv.creneau_debut);
              const dot = techDotColor(iv.technicien_id);
              const techLabel = iv.technicien
                ? [iv.technicien.prenom, iv.technicien.nom].filter(Boolean).join(' ').trim()
                : null;
              const adresse = [iv.acp?.adresse, iv.acp?.ville].filter(Boolean).join(', ');
              const isPending = iv.statut !== 'confirmee';

              const inner = (
                <div className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--color-sand-hover)]">
                  <span
                    className="font-sora text-[11px] font-semibold tabular-nums flex-shrink-0"
                    style={{ color: 'var(--color-navy)' }}
                  >
                    {time}
                  </span>
                  <span
                    className="inline-block rounded-full flex-shrink-0"
                    style={{ width: 8, height: 8, background: dot }}
                    aria-hidden
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] text-[var(--color-ink)] flex items-center gap-1.5 flex-wrap">
                      {iv.ref && (
                        <span
                          className="font-sora text-[11px] font-semibold"
                          style={{ color: 'var(--color-navy)', letterSpacing: '0.01em' }}
                        >
                          {iv.ref}
                        </span>
                      )}
                      <span className="font-medium truncate">
                        {iv.acp?.nom ?? iv.particulier_contact?.nom ?? '—'}
                      </span>
                    </div>
                    <div className="text-[10.5px] text-[var(--color-ink-muted)] truncate mt-0.5">
                      {adresse || (iv.type ?? '—')}
                      {techLabel && <span className="ml-1.5">· {techLabel}</span>}
                      {iv.type && adresse && <span className="ml-1.5">· {iv.type}</span>}
                    </div>
                  </div>
                  <span
                    className="text-[9px] font-semibold uppercase tracking-[0.1em] px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0"
                    style={
                      isPending
                        ? { background: 'var(--color-amber-light)', color: 'var(--color-amber-foxo)' }
                        : { background: 'var(--color-ok-light)', color: 'var(--color-ok)' }
                    }
                  >
                    {isPending ? 'En attente' : 'Confirmé'}
                  </span>
                </div>
              );

              return (
                <li key={iv.id}>
                  {onOpenIntervention ? (
                    <button
                      type="button"
                      onClick={() => onOpenIntervention(iv.id)}
                      className="w-full text-left bg-transparent border-0 cursor-pointer block"
                    >
                      {inner}
                    </button>
                  ) : (
                    <Link
                      href={`/admin/interventions/${iv.id}`}
                      className="block"
                    >
                      {inner}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {overflow > 0 && (
          <div className="px-4 py-2 text-[11px] text-[var(--color-ink-muted)] italic text-center border-t border-[var(--color-sand-mid)]">
            +{overflow} autre{overflow > 1 ? 's' : ''} mission{overflow > 1 ? 's' : ''} aujourd&apos;hui — utilise la liste complète plus bas.
          </div>
        )}
      </div>
    </div>
  );
}
