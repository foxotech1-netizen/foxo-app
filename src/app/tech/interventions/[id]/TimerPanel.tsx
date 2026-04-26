'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
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
    <section className="bg-[#0F2040] border border-navy rounded-2xl p-4">
      <div className="text-[10px] font-bold text-[#5A7494] uppercase tracking-widest mb-3">
        Suivi temps
      </div>

      {!startedAt && (
        <button
          onClick={onStart}
          disabled={pending}
          className="w-full bg-ok text-white py-3.5 rounded-xl font-bold text-[15px] disabled:opacity-50 active:opacity-80"
        >
          {pending ? 'Démarrage…' : '▶ Démarrer l\'intervention'}
        </button>
      )}

      {startedAt && !endedAt && (
        <>
          <div className="text-center mb-3">
            <div className="text-[10px] text-[#5A7494] uppercase tracking-widest mb-1">
              En cours
            </div>
            <div className="text-3xl font-extrabold text-[#A8D4E8] font-mono tabular-nums">
              {elapsed}
            </div>
            <div className="text-[10px] text-[#5A7494] mt-1">
              Démarré à {new Date(startedAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
          <button
            onClick={onEnd}
            disabled={pending}
            className="w-full bg-terra text-white py-3.5 rounded-xl font-bold text-[15px] disabled:opacity-50 active:opacity-80"
          >
            {pending ? 'Clôture…' : '■ Clôturer l\'intervention'}
          </button>
        </>
      )}

      {endedAt && (
        <div className="bg-[#152D54] rounded-xl p-3.5 text-center">
          <div className="text-[10px] text-[#5A7494] uppercase tracking-widest mb-1">
            Terminée
          </div>
          <div className="text-2xl font-extrabold text-[#A8D4E8] font-mono tabular-nums">
            {elapsed}
          </div>
          <div className="text-[10px] text-[#8AAAC0] mt-1">
            {startedAt && new Date(startedAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}
            {' — '}
            {new Date(endedAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}
          </div>
          <div className="text-[11px] text-[#5A7494] mt-2">Statut actuel : {statut}</div>
        </div>
      )}

      {error && (
        <div className="text-[11px] text-terra bg-terra-light/10 border border-terra/30 rounded-md px-3 py-2 mt-2">
          {error}
        </div>
      )}
    </section>
  );
}
