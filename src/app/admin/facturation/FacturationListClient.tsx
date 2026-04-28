'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { STATUT_FACTURE_INFO, type Facture, type StatutFacture } from '@/lib/types/database';
import {
  setFactureStatut,
  importBeobankCsv,
  buildComptableCsvForRange,
  sendComptableEmail,
} from './actions';

const STATUTS: ('tous' | StatutFacture)[] = ['tous', 'brouillon', 'envoyee', 'payee', 'en_retard', 'annulee'];

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtMoney(n: number | null | undefined): string {
  const v = typeof n === 'number' ? n : 0;
  return v.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function thisMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return { from, to };
}

export function FacturationListClient({ initialFactures }: { initialFactures: Facture[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<typeof STATUTS[number]>('tous');
  const csvFileRef = useRef<HTMLInputElement>(null);

  // Marque les factures dont l'échéance est dépassée ET non payées comme "en_retard"
  // côté UI (sans persister — l'admin peut explicitement marquer comme payée)
  const today = new Date().toISOString().slice(0, 10);
  const factures = useMemo(() => initialFactures.map((f) => {
    if (f.statut === 'envoyee' && f.date_echeance && f.date_echeance < today) {
      return { ...f, statut: 'en_retard' as StatutFacture };
    }
    return f;
  }), [initialFactures, today]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return factures.filter((f) => {
      const matchQ = !q
        || f.numero.toLowerCase().includes(q)
        || (f.client_nom ?? '').toLowerCase().includes(q)
        || (f.reference ?? '').toLowerCase().includes(q);
      const matchF = filter === 'tous' || f.statut === filter;
      return matchQ && matchF;
    });
  }, [factures, query, filter]);

  // Stats
  const stats = useMemo(() => {
    const m = thisMonthRange();
    const monthRange = factures.filter((f) => f.date_emission && f.date_emission >= m.from && f.date_emission <= m.to);
    const totalMois = monthRange.reduce((s, f) => s + (f.montant_ttc ?? 0), 0);
    const enAttente = factures.filter((f) => f.statut === 'envoyee' || f.statut === 'en_retard').reduce((s, f) => s + (f.montant_ttc ?? 0), 0);
    const enRetard = factures.filter((f) => f.statut === 'en_retard').length;
    return { totalMois, enAttente, enRetard, count: monthRange.length };
  }, [factures]);

  function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFeedback(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      startTransition(async () => {
        const res = await importBeobankCsv(text);
        if (!res.ok) {
          setFeedback({ kind: 'err', msg: res.error });
        } else {
          setFeedback({
            kind: 'ok',
            msg: `Import : ${res.data?.matched ?? 0} matchée(s), ${res.data?.unmatched ?? 0} non matchée(s).`,
          });
          router.refresh();
        }
      });
    };
    reader.readAsText(file, 'utf-8');
    if (csvFileRef.current) csvFileRef.current.value = '';
  }

  function handleExportCsv() {
    setFeedback(null);
    const r = thisMonthRange();
    startTransition(async () => {
      const res = await buildComptableCsvForRange(r.from, r.to);
      if (!res.ok) {
        setFeedback({ kind: 'err', msg: res.error });
        return;
      }
      const blob = new Blob([res.data!.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `factures-${r.from}-${r.to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setFeedback({ kind: 'ok', msg: `Export généré (${res.data!.count} factures).` });
    });
  }

  function handleSendComptable() {
    if (!confirm('Envoyer l\'export du mois en cours au comptable ?')) return;
    setFeedback(null);
    const r = thisMonthRange();
    startTransition(async () => {
      const res = await sendComptableEmail(r.from, r.to);
      if (!res.ok) {
        setFeedback({ kind: 'err', msg: res.error });
      } else {
        setFeedback({ kind: 'ok', msg: `Email envoyé au comptable (${res.data?.sent ?? 0} factures).` });
      }
    });
  }

  function markPaid(id: string) {
    startTransition(async () => {
      const res = await setFactureStatut(id, 'payee');
      if (!res.ok) setFeedback({ kind: 'err', msg: res.error });
      else router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <StatCard num={fmtMoney(stats.totalMois)} label={`Facturé ce mois (${stats.count})`} />
        <StatCard num={fmtMoney(stats.enAttente)} label="En attente de paiement" accent />
        <StatCard num={String(stats.enRetard)} label="En retard" warning={stats.enRetard > 0} />
        <StatCard num={String(factures.length)} label="Total chargé" muted />
      </div>

      {/* Actions globales */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher — n° facture, client, référence…"
          className="flex-1 min-w-[200px] px-3.5 py-2.5 border border-sand-border rounded-lg text-xs bg-cream outline-none focus:border-navy-mid"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          className="px-3 py-2.5 border border-sand-border rounded-lg text-xs bg-cream cursor-pointer"
        >
          {STATUTS.map((s) => (
            <option key={s} value={s}>
              {s === 'tous' ? 'Tous statuts' : STATUT_FACTURE_INFO[s as StatutFacture].label}
            </option>
          ))}
        </select>
        <input
          ref={csvFileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleCsvUpload}
          className="hidden"
          id="csv-import"
        />
        <label
          htmlFor="csv-import"
          className="bg-[#A17244] text-white px-3.5 py-2.5 rounded-lg text-xs font-bold hover:opacity-90 cursor-pointer"
        >
          ⬇ Import Beobank CSV
        </label>
        <button
          type="button"
          onClick={handleExportCsv}
          disabled={pending}
          className="bg-sand-mid text-ink-mid border border-sand-border px-3.5 py-2.5 rounded-lg text-xs font-bold hover:bg-sand-hover disabled:opacity-50"
        >
          ⬆ Export comptable
        </button>
        <button
          type="button"
          onClick={handleSendComptable}
          disabled={pending}
          className="bg-ok text-white px-3.5 py-2.5 rounded-lg text-xs font-bold hover:opacity-90 disabled:opacity-50"
        >
          ✉ Envoyer au comptable
        </button>
      </div>

      {feedback && (
        <div
          className={
            'text-[12px] rounded-md px-3 py-2 border font-semibold ' +
            (feedback.kind === 'ok'
              ? 'bg-ok-light border-ok-mid text-ok'
              : 'bg-terra-light border-terra-mid text-terra')
          }
        >
          {feedback.msg}
        </div>
      )}

      {/* Tableau */}
      <div className="bg-cream rounded-xl border border-sand-border overflow-hidden dark:bg-[#1C1A16] dark:border-[#3D3A32]">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[860px]">
            <thead>
              <tr className="bg-sand dark:bg-[#221E1A]">
                {['N°', 'Client', 'Référence', 'Émission', 'Échéance', 'HT', 'TVA', 'TTC', 'Statut', 'Actions'].map((h) => (
                  <th key={h} className="px-3.5 py-2.5 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-sand-border whitespace-nowrap dark:text-[#C8C2B8] dark:border-[#3D3A32]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-12 text-ink-muted text-[13px] dark:text-[#C8C2B8]">
                    Aucune facture ne correspond au filtre.
                  </td>
                </tr>
              ) : (
                filtered.map((f) => (
                  <tr key={f.id} className="border-b border-sand-mid hover:bg-sand-hover dark:border-[#3D3A32] dark:hover:bg-[#2A2520]">
                    <td className="px-3.5 py-2.5 whitespace-nowrap">
                      <Link
                        href={`/admin/facturation/${f.id}`}
                        className="font-mono text-xs font-bold text-navy hover:underline dark:text-[#A8C4F2]"
                      >
                        {f.numero}
                      </Link>
                    </td>
                    <td className="px-3.5 py-2.5">
                      <div className="text-xs font-semibold dark:text-[#F0ECE4]">{f.client_nom ?? '—'}</div>
                      {f.client_syndic && (
                        <div className="text-[10px] text-ink-muted dark:text-[#C8C2B8]">{f.client_syndic}</div>
                      )}
                    </td>
                    <td className="px-3.5 py-2.5 text-[11px] text-ink-mid dark:text-[#C8C2B8]">
                      {f.reference ?? '—'}
                    </td>
                    <td className="px-3.5 py-2.5 text-[11px] text-ink-mid font-mono whitespace-nowrap dark:text-[#C8C2B8]">
                      {fmtDate(f.date_emission)}
                    </td>
                    <td className="px-3.5 py-2.5 text-[11px] text-ink-mid font-mono whitespace-nowrap dark:text-[#C8C2B8]">
                      {fmtDate(f.date_echeance)}
                    </td>
                    <td className="px-3.5 py-2.5 text-[11px] font-mono whitespace-nowrap dark:text-[#F0ECE4]">
                      {fmtMoney(f.montant_ht)}
                    </td>
                    <td className="px-3.5 py-2.5 text-[11px] font-mono whitespace-nowrap text-ink-mid dark:text-[#C8C2B8]">
                      {fmtMoney(f.montant_tva)}
                    </td>
                    <td className="px-3.5 py-2.5 text-[12px] font-mono font-bold whitespace-nowrap dark:text-white">
                      {fmtMoney(f.montant_ttc)}
                    </td>
                    <td className="px-3.5 py-2.5">
                      <StatutBadge statut={f.statut} />
                    </td>
                    <td className="px-3.5 py-2.5 whitespace-nowrap">
                      <div className="flex gap-1.5">
                        <a
                          href={`/api/admin/facture/${f.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-navy underline hover:no-underline dark:text-[#A8C4F2]"
                        >
                          PDF
                        </a>
                        {f.statut !== 'payee' && f.statut !== 'annulee' && (
                          <button
                            type="button"
                            onClick={() => markPaid(f.id)}
                            disabled={pending}
                            className="text-[10px] text-ok underline hover:no-underline disabled:opacity-50 dark:text-[#7AC9A0]"
                          >
                            Payée
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatutBadge({ statut }: { statut: StatutFacture }) {
  const info = STATUT_FACTURE_INFO[statut];
  return (
    <span
      className="inline-block rounded-full font-semibold text-[10px] px-2 py-0.5 whitespace-nowrap"
      style={{ color: info.fg, background: info.bg }}
    >
      {info.label}
    </span>
  );
}

function StatCard({
  num, label, accent, muted, warning,
}: {
  num: string; label: string;
  accent?: boolean; muted?: boolean; warning?: boolean;
}) {
  let bg = 'bg-cream';
  let border = 'border-sand-border';
  let numColor = '';
  if (accent) { bg = 'bg-navy-pale'; border = 'border-navy-light'; numColor = 'text-navy dark:text-white'; }
  if (muted) numColor = 'text-ink-mid dark:text-[#C8C2B8]';
  if (warning) { bg = 'bg-terra-light'; border = 'border-terra-mid'; numColor = 'text-terra dark:text-white'; }
  return (
    <div className={`${bg} ${border} border rounded-xl px-4 py-3 dark:bg-[#1C1A16] dark:border-[#3D3A32]`}>
      <div className={`text-[18px] font-extrabold leading-tight ${numColor || 'stat-num'}`}>{num}</div>
      <div className="text-[10px] text-ink-muted mt-1 font-semibold dark:text-[#C8C2B8]">{label}</div>
    </div>
  );
}
