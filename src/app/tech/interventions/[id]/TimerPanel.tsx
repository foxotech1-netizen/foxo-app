'use client';

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

  return (
    <section className="premium-card">
      <div className="section-label mb-3">
        Suivi temps
      </div>

      {!startedAt && (
        <button
          onClick={onStart}
          disabled={pending}
          className="w-full bg-ok text-white py-3.5 rounded-xl font-bold text-[15px] disabled:opacity-50 active:opacity-80 transition-opacity hover:opacity-90"
        >
          {pending ? 'Démarrage…' : <><Play size={15} className="inline mr-1" />Démarrer l&apos;intervention</>}
        </button>
      )}

      {startedAt && !endedAt && (
        <>
          <div className="text-center mb-3">
            <div className="section-label mb-1">
              En cours
            </div>
            <div className="text-3xl font-extrabold text-navy font-mono tabular-nums">
              {elapsed}
            </div>
            <div className="text-[10px] text-ink-muted mt-1">
              Démarré à <span className="font-mono">{new Date(startedAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
          <button
            onClick={onEnd}
            disabled={pending}
            className="w-full bg-terra text-white py-3.5 rounded-xl font-bold text-[15px] disabled:opacity-50 active:opacity-80 transition-opacity hover:opacity-90"
          >
            {pending ? 'Clôture…' : <><Square size={15} className="inline mr-1" />Clôturer l&apos;intervention</>}
          </button>
        </>
      )}

      {endedAt && (
        <div className="bg-navy-pale border border-navy-light rounded-xl p-3.5 text-center">
          <div className="section-label mb-1">
            Terminée
          </div>
          <div className="text-2xl font-extrabold text-navy font-mono tabular-nums">
            {elapsed}
          </div>
          <div className="text-[10px] text-ink-mid mt-1 font-mono">
            {startedAt && new Date(startedAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}
            {' — '}
            {new Date(endedAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}
          </div>
          <div className="text-[11px] text-ink-muted mt-2">Statut actuel : {statut}</div>
        </div>
      )}

      {error && (
        <div className="text-[11px] text-terra bg-terra-light border border-terra-mid rounded-md px-3 py-2 mt-2 font-semibold">
          {error}
        </div>
      )}
    </section>
  );
}
