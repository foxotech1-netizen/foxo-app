'use client';

import { useState } from 'react';
import { Check, X, Play, Loader2 } from 'lucide-react';

export interface PendingAction {
  id: string;
  action: string;
  params: Record<string, unknown>;
  summary: string;
}

type CardStatus = 'idle' | 'executing' | 'done' | 'error' | 'cancelled';

export function ActionConfirmCard({ pendingAction }: { pendingAction: PendingAction }) {
  const [status, setStatus] = useState<CardStatus>('idle');
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function execute() {
    setStatus('executing');
    setErrorMsg(null);
    try {
      const res = await fetch('/api/admin/assistant/actions/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: pendingAction.action, params: pendingAction.params }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error ?? `Échec de l'action (HTTP ${res.status}).`);
        setStatus('error');
        return;
      }
      setResultMsg(data.message ?? 'Action effectuée.');
      setStatus('done');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Erreur réseau.');
      setStatus('error');
    }
  }

  if (status === 'done') {
    return (
      <div className="bg-cream border border-sand-border rounded-lg px-3 py-2 inline-flex items-start gap-2">
        <Check size={14} className="text-ok mt-0.5 flex-shrink-0" aria-hidden />
        <span className="text-[12px] text-ink font-semibold">{resultMsg}</span>
      </div>
    );
  }

  if (status === 'cancelled') {
    return (
      <div className="text-[12px] text-ink-muted italic px-3 py-2">Action annulée.</div>
    );
  }

  return (
    <div className="bg-navy-pale border border-navy-light rounded-lg px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider font-bold mb-1 text-navy">Action à confirmer</div>
      <div className="text-[12px] text-ink mb-2 leading-relaxed">{pendingAction.summary}</div>
      {status === 'error' && errorMsg && (
        <div className="bg-terra-light border border-terra-mid text-terra text-[11px] rounded-md px-2 py-1.5 mb-2 font-semibold">
          {errorMsg}
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={execute}
          disabled={status === 'executing'}
          className="bg-navy text-white text-[12px] font-bold px-3 py-1.5 rounded-md hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {status === 'executing' ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Play size={13} aria-hidden />}
          {status === 'executing' ? 'Exécution…' : status === 'error' ? 'Réessayer' : 'Exécuter'}
        </button>
        <button
          type="button"
          onClick={() => setStatus('cancelled')}
          disabled={status === 'executing'}
          className="bg-white border border-sand-border text-ink-mid text-[12px] font-semibold px-3 py-1.5 rounded-md hover:border-terra-mid hover:text-terra disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          <X size={13} aria-hidden />
          Annuler
        </button>
      </div>
    </div>
  );
}
