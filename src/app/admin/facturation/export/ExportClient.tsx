'use client';

import { TZ_BRUSSELS } from '@/lib/format';
import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Calendar, Download, Send, AlertTriangle, Archive, Check, X } from 'lucide-react';
import { buildComptableCsvForRange, sendComptableEmail } from '../actions';

type Periode = 'mois' | 'trimestre' | 'annee' | 'custom';

interface HistEntry {
  id: string;
  message: string | null;
  status: string | null;
  sent_at: string | null;
  sent_by: string | null;
  error: string | null;
}

function pad(n: number): string { return String(n).padStart(2, '0'); }

function rangeFor(p: Periode, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date();
  if (p === 'mois') {
    const from = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const to = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(last)}`;
    return { from, to };
  }
  if (p === 'trimestre') {
    const tStart = Math.floor(now.getMonth() / 3) * 3;
    const from = `${now.getFullYear()}-${pad(tStart + 1)}-01`;
    const endMonth = tStart + 2;
    const last = new Date(now.getFullYear(), endMonth + 1, 0).getDate();
    const to = `${now.getFullYear()}-${pad(endMonth + 1)}-${pad(last)}`;
    return { from, to };
  }
  if (p === 'annee') {
    return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` };
  }
  return { from: customFrom, to: customTo };
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-BE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: TZ_BRUSSELS,
  });
}

export function ExportClient({
  emailComptable, history,
}: {
  emailComptable: string | null;
  history: HistEntry[];
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [periode, setPeriode] = useState<Periode>('mois');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const range = useMemo(() => rangeFor(periode, customFrom, customTo), [periode, customFrom, customTo]);

  function handleDownload() {
    setFeedback(null);
    if (periode === 'custom' && (!customFrom || !customTo)) {
      setFeedback({ kind: 'err', msg: 'Choisis des dates de début et de fin.' });
      return;
    }
    startTransition(async () => {
      const res = await buildComptableCsvForRange(range.from, range.to);
      if (!res.ok) {
        setFeedback({ kind: 'err', msg: res.error });
        return;
      }
      const blob = new Blob([res.data!.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `factures-${range.from}-${range.to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setFeedback({ kind: 'ok', msg: `Export généré (${res.data!.count} factures).` });
    });
  }

  function handleSendComptable() {
    if (!emailComptable) {
      setFeedback({ kind: 'err', msg: 'Email comptable non configuré (voir /admin/parametres).' });
      return;
    }
    if (!confirm(`Envoyer l'export ${range.from} → ${range.to} à ${emailComptable} ?`)) return;
    setFeedback(null);
    startTransition(async () => {
      const res = await sendComptableEmail(range.from, range.to);
      if (!res.ok) {
        setFeedback({ kind: 'err', msg: res.error });
      } else {
        setFeedback({ kind: 'ok', msg: `Email envoyé au comptable (${res.data?.sent ?? 0} factures).` });
      }
    });
  }

  return (
    <div className="space-y-6">
      <section className="bg-cream rounded-xl border border-sand-border p-4 space-y-3">
        <div>
          <h2 className="text-[13px] font-extrabold text-ink inline-flex items-center gap-1.5"><Calendar size={14} aria-hidden /> Période</h2>
          <p className="text-[11px] text-ink-muted mt-0.5">
            Range actuel : <strong className="font-mono">{range.from}</strong> → <strong className="font-mono">{range.to}</strong>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {([
            { v: 'mois' as const, label: 'Mois en cours' },
            { v: 'trimestre' as const, label: 'Trimestre' },
            { v: 'annee' as const, label: 'Année' },
            { v: 'custom' as const, label: 'Personnalisée' },
          ]).map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => setPeriode(opt.v)}
              className={
                'px-3 py-1.5 rounded-md text-[12px] font-bold border transition-colors ' +
                (periode === opt.v
                  ? 'bg-navy text-white border-navy'
                  : 'bg-white text-ink-mid border-sand-border hover:border-navy-mid')
              }
            >
              {opt.label}
            </button>
          ))}
        </div>

        {periode === 'custom' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-ink-muted block mb-1">Du</label>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-ink-muted block mb-1">Au</label>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={handleDownload}
            disabled={pending}
            className="bg-sand-mid text-ink-mid border border-sand-border px-3.5 py-2 rounded-lg text-xs font-bold hover:bg-sand-hover disabled:opacity-50 dark:bg-[rgba(255,255,255,.06)] inline-flex items-center gap-1.5"
          >
            <Download size={14} aria-hidden /> Télécharger CSV
          </button>
          <button
            type="button"
            onClick={handleSendComptable}
            disabled={pending || !emailComptable}
            className="bg-ok text-white px-3.5 py-2 rounded-lg text-xs font-bold hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
            title={!emailComptable ? 'Email comptable non configuré' : undefined}
          >
            <Send size={14} aria-hidden /> Envoyer au comptable
          </button>
          {!emailComptable && (
            <span className="text-[11px] text-terra italic self-center inline-flex items-center gap-1.5">
              <AlertTriangle size={12} aria-hidden /> Configure d&apos;abord l&apos;email comptable dans <Link href="/admin/parametres" className="underline">Paramètres</Link>.
            </span>
          )}
        </div>

        {feedback && (
          <div className={
            'text-[12px] rounded-md px-3 py-2 border font-semibold ' +
            (feedback.kind === 'ok' ? 'bg-ok-light border-ok-mid text-ok' : 'bg-terra-light border-terra-mid text-terra')
          }>
            {feedback.msg}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-[13px] font-extrabold text-ink mb-2 flex items-center gap-2">
          <Archive size={14} aria-hidden /> Historique des exports
        </h2>
        {history.length === 0 ? (
          <div className="bg-cream rounded-xl border border-sand-border p-6 text-center text-[12px] text-ink-muted">
            Aucun export envoyé pour l&apos;instant.
          </div>
        ) : (
          <div className="bg-cream rounded-xl border border-sand-border overflow-hidden">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-sand">
                  {['Date', 'Statut', 'Description', 'Par'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-sand-border">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b border-sand-mid">
                    <td className="px-3 py-2 text-[11px] font-mono text-ink-mid whitespace-nowrap">{fmtDateTime(h.sent_at)}</td>
                    <td className="px-3 py-2">
                      <span className={
                        'inline-flex items-center gap-1 text-[10px] font-bold rounded-full px-2 py-0.5 ' +
                        (h.status === 'sent'
                          ? 'bg-ok-light text-ok border border-ok-mid'
                          : 'bg-terra-light text-terra border border-terra-mid')
                      }>
                        {h.status === 'sent'
                          ? (<><Check size={12} aria-hidden /> Envoyé</>)
                          : (<><X size={12} aria-hidden /> {h.status ?? 'inconnu'}</>)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-ink">{h.message ?? '—'}</td>
                    <td className="px-3 py-2 text-[10px] text-ink-muted">{h.sent_by ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
