'use client';

import { fmtTime } from '@/lib/format';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Play, Square } from 'lucide-react';
import { startIntervention, endIntervention } from '../../actions';
import type { StatutIntervention } from '@/lib/types/database';

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
  return `${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
}

export function TimerPanel({
  interventionId,
  startedAt,
  endedAt,
  statut,
}: {
  interventionId: string;
  startedAt: string | null;
  endedAt: string | null;
  statut: StatutIntervention;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const inProgress = startedAt && !endedAt;

  // Tick chaque seconde quand chrono actif
  useEffect(() => {
    if (!inProgress) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [inProgress]);

  function onStart() {
    setError(null);
    startTransition(async () => {
      const res = await startIntervention(interventionId);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }
  function onEnd() {
    setError(null);
    if (!confirm('Clôturer l\'intervention ? Tu pourras toujours éditer le rapport ensuite.')) return;
    startTransition(async () => {
      const res = await endIntervention(interventionId);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  let elapsed: string | null = null;
  if (startedAt) {
    const startMs = new Date(startedAt).getTime();
    const endMs = endedAt ? new Date(endedAt).getTime() : Date.now() + tick * 0; // tick juste pour re-render
    elapsed = fmtDuration(endMs - startMs);
  }

  // Détermine la couleur du timer en cours selon la durée écoulée :
  // amber si > 1h, rouge si > 2h, sinon vert tech (alerte visuelle
  // terrain). Seuils inchangés — couleurs mappées sur les tokens sombres
  // (les alertes clair --color-terra/-amber-foxo manquent de contraste
  // sur le fond marine).
  const timerColor = (() => {
    if (!inProgress || !startedAt) return 'var(--accent-tech)';
    const elapsedMs = Date.now() - new Date(startedAt).getTime();
    if (elapsedMs > 2 * 3600_000) return 'var(--tech-btn-red-1)';
    if (elapsedMs > 3600_000)     return 'var(--tech-cta-2)';
    return 'var(--accent-tech)';
  })();

  // Carte verre sombre (thème tech) — la logique start/stop ci-dessus est
  // strictement identique à la version claire d'origine.
  return (
    <section className="tech-glass-card p-5">
      <div className="flex items-center gap-2.5 mb-3">
        <span className="w-[3px] h-3.5 rounded-sm bg-[var(--accent-tech)]"></span>
        <div
          className="font-sora text-[11px] font-medium uppercase tracking-[0.12em]"
          style={{ color: 'var(--tech-text-2)' }}
        >
          Suivi temps
        </div>
      </div>

      {!startedAt && (
        <button
          onClick={onStart}
          disabled={pending}
          className="tech-cta-3d tech-cta-3d-green text-[16px] disabled:opacity-50"
        >
          {pending ? 'Démarrage…' : <><Play size={18} />Démarrer l&apos;intervention</>}
        </button>
      )}

      {startedAt && !endedAt && (
        <>
          <div className="text-center mb-4">
            <div
              className="font-sora text-[11px] font-medium uppercase tracking-[0.12em] mb-1.5"
              style={{ color: 'var(--tech-cta-2)' }}
            >
              En cours
            </div>
            <div
              className="font-sora text-[26px] font-semibold tabular-nums tracking-[-0.02em]"
              style={{ color: timerColor }}
            >
              {elapsed}
            </div>
            <div className="text-[12px] mt-1" style={{ color: 'var(--tech-text-2)' }}>
              Démarré à{' '}
              <span className="font-mono" style={{ color: 'var(--tech-text-1)' }}>
                {fmtTime(startedAt)}
              </span>
            </div>
          </div>
          <button
            onClick={onEnd}
            disabled={pending}
            className="tech-cta-3d tech-cta-3d-red text-[16px] disabled:opacity-50"
          >
            {pending ? 'Clôture…' : <><Square size={18} />Clôturer l&apos;intervention</>}
          </button>
        </>
      )}

      {endedAt && (
        <div
          className="rounded-xl p-4 text-center"
          style={{
            background: 'var(--tech-glass-bright)',
            border: '1px solid var(--tech-line)',
          }}
        >
          <div
            className="font-sora text-[11px] font-medium uppercase tracking-[0.12em] mb-1.5"
            style={{ color: 'var(--accent-tech)' }}
          >
            Terminée
          </div>
          <div
            className="font-sora text-[26px] font-semibold tabular-nums tracking-[-0.02em]"
            style={{ color: 'var(--accent-tech)' }}
          >
            {elapsed}
          </div>
          <div className="text-[12px] mt-1.5 font-mono" style={{ color: 'var(--tech-text-2)' }}>
            {startedAt && fmtTime(startedAt)}
            {' — '}
            {fmtTime(endedAt)}
          </div>
          <div className="text-[12px] mt-2" style={{ color: 'var(--tech-text-2)' }}>
            Statut actuel : {statut}
          </div>
        </div>
      )}

      {error && (
        <div className="text-[12px] text-[var(--color-terra)] bg-[var(--color-terra-light)] border border-[var(--color-terra-mid)] rounded-md px-3 py-2 mt-3 font-semibold">
          {error}
        </div>
      )}
    </section>
  );
}
