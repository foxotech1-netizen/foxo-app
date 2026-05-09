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

  // Détermine la couleur du timer en cours selon la durée écoulée :
  // amber si > 1h, terra si > 2h, sinon vert tech (alerte visuelle terrain).
  const timerColor = (() => {
    if (!inProgress || !startedAt) return 'var(--accent-tech)';
    const elapsedMs = Date.now() - new Date(startedAt).getTime();
    if (elapsedMs > 2 * 3600_000) return 'var(--color-terra)';
    if (elapsedMs > 3600_000)     return 'var(--color-amber-foxo)';
    return 'var(--accent-tech)';
  })();

  return (
    <section
      className="bg-[var(--color-cream)] rounded-xl p-5"
      style={{ boxShadow: '0 1px 2px rgba(15,32,64,0.04), 0 4px 12px rgba(15,32,64,0.05), 0 0 0 1px rgba(15,32,64,0.04)' }}
    >
      <div className="flex items-center gap-2.5 mb-3">
        <span className="w-[3px] h-3.5 rounded-sm bg-[var(--accent-tech)]"></span>
        <div className="font-sora text-[11px] font-medium text-[var(--color-ink-mid)] uppercase tracking-[0.12em]">
          Suivi temps
        </div>
      </div>

      {!startedAt && (
        <button
          onClick={onStart}
          disabled={pending}
          className="w-full bg-[var(--color-ok)] text-[var(--color-cream)] py-4 rounded-xl font-semibold text-[16px] disabled:opacity-50 active:opacity-80 transition-opacity hover:opacity-90 min-h-[48px] inline-flex items-center justify-center gap-2"
        >
          {pending ? 'Démarrage…' : <><Play size={18} />Démarrer l&apos;intervention</>}
        </button>
      )}

      {startedAt && !endedAt && (
        <>
          <div className="text-center mb-4">
            <div className="font-sora text-[11px] font-medium text-[var(--color-amber-foxo)] uppercase tracking-[0.12em] mb-1.5">
              En cours
            </div>
            <div
              className="font-sora text-[28px] font-semibold font-mono tabular-nums tracking-[-0.02em]"
              style={{ color: timerColor }}
            >
              {elapsed}
            </div>
            <div className="text-[12px] text-[var(--color-ink-mid)] mt-1">
              Démarré à <span className="font-mono text-[var(--color-ink)]">{new Date(startedAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
          <button
            onClick={onEnd}
            disabled={pending}
            className="w-full bg-[var(--color-terra)] text-[var(--color-cream)] py-4 rounded-xl font-semibold text-[16px] disabled:opacity-50 active:opacity-80 transition-opacity hover:opacity-90 min-h-[48px] inline-flex items-center justify-center gap-2"
          >
            {pending ? 'Clôture…' : <><Square size={18} />Clôturer l&apos;intervention</>}
          </button>
        </>
      )}

      {endedAt && (
        <div className="bg-[var(--color-ok-light)] border border-[var(--color-ok-mid)] rounded-xl p-4 text-center">
          <div className="font-sora text-[11px] font-medium text-[var(--color-ok)] uppercase tracking-[0.12em] mb-1.5">
            Terminée
          </div>
          <div className="font-sora text-[24px] font-semibold text-[var(--color-ok)] font-mono tabular-nums tracking-[-0.02em]">
            {elapsed}
          </div>
          <div className="text-[12px] text-[var(--color-ink-mid)] mt-1.5 font-mono">
            {startedAt && new Date(startedAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}
            {' — '}
            {new Date(endedAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}
          </div>
          <div className="text-[12px] text-[var(--color-ink-mid)] mt-2">Statut actuel : {statut}</div>
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
