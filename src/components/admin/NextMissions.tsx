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
    <section className="fx-card overflow-hidden" aria-label="Aujourd'hui">
      <div className="fx-card-head">
        <h2 className="fx-h2">Aujourd&apos;hui</h2>
        <span className="fx-badge fx-badge-navy">{missions.length}</span>
      </div>

      {visible.length === 0 ? (
        <p className="fx-card-row fx-meta text-center py-6 m-0">Aucune mission prévue aujourd&apos;hui.</p>
      ) : (
        <ul className="m-0 p-0 list-none">
          {visible.map((iv) => {
            const time = fmtTime(iv.creneau_debut);
            const dot = techDotColor(iv.technicien_id);
            const techLabel = iv.technicien
              ? [iv.technicien.prenom, iv.technicien.nom].filter(Boolean).join(' ').trim()
              : null;
            const adresse = [iv.acp?.adresse, iv.acp?.ville].filter(Boolean).join(', ');
            const demandeur = iv.acp?.nom ?? iv.particulier_contact?.nom ?? null;
            const isPending = iv.statut !== 'confirmee';

            const inner = (
              <div className="fx-card-row flex items-center gap-3 hover:bg-sand-hover">
                <span className="fx-time">{time}</span>
                <span
                  className={`w-[3px] self-stretch min-h-[34px] rounded-sm shrink-0 ${isPending ? 'bg-amber-foxo' : 'bg-ok'}`}
                  aria-hidden
                />
                <div className="flex-1 min-w-0">
                  <div className="fx-body font-medium truncate">{adresse || demandeur || '—'}</div>
                  <div className="fx-meta truncate flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: dot }} aria-hidden />
                    {iv.type && <span>{iv.type}</span>}
                    {iv.ref && <><span aria-hidden>·</span><span className="fx-ref">{iv.ref}</span></>}
                    {demandeur && adresse && <><span aria-hidden>·</span><span className="truncate">{demandeur}</span></>}
                    {techLabel && <><span aria-hidden>·</span><span className="truncate">{techLabel}</span></>}
                  </div>
                </div>
                <span className={`fx-pill ${isPending ? 'fx-pill-amber' : 'fx-pill-ok'}`}>
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
                  <Link href={`/admin/interventions/${iv.id}`} className="block">
                    {inner}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {overflow > 0 && (
        <div className="fx-card-row fx-meta text-center">
          +{overflow} autre{overflow > 1 ? 's' : ''} mission{overflow > 1 ? 's' : ''} aujourd&apos;hui — voir la liste complète plus bas.
        </div>
      )}
    </section>
  );
}
