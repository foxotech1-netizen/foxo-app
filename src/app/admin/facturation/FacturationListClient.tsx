'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { STATUT_FACTURE_INFO, type Facture, type StatutFacture } from '@/lib/types/database';
import { RowMenu } from '@/components/RowMenu';
import {
  setFactureStatut,
  deleteFacture,
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

export type AvoirsAggByFacture = Record<string, { totalEmis: number; totalAll: number }>;

export function FacturationListClient({
  initialFactures,
  avoirsByFacture = {},
}: {
  initialFactures: Facture[];
  avoirsByFacture?: AvoirsAggByFacture;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<typeof STATUTS[number]>('tous');

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

  function markPaid(id: string) {
    startTransition(async () => {
      const res = await setFactureStatut(id, 'payee');
      if (!res.ok) setFeedback({ kind: 'err', msg: res.error });
      else router.refresh();
    });
  }

  function markEnvoyee(id: string) {
    startTransition(async () => {
      const res = await setFactureStatut(id, 'envoyee');
      if (!res.ok) setFeedback({ kind: 'err', msg: res.error });
      else { setFeedback({ kind: 'ok', msg: 'Facture marquée envoyée.' }); router.refresh(); }
    });
  }

  function handleDelete(f: Facture) {
    const isDraft = f.statut === 'brouillon';
    const confirmMsg = isDraft
      ? `Supprimer définitivement le brouillon ${f.numero} ?`
      : `Annuler la facture ${f.numero} ? (elle sera marquée "annulée", pas supprimée)`;
    if (!confirm(confirmMsg)) return;
    startTransition(async () => {
      const res = await deleteFacture(f.id);
      if (!res.ok) setFeedback({ kind: 'err', msg: res.error });
      else { setFeedback({ kind: 'ok', msg: isDraft ? 'Brouillon supprimé.' : 'Facture annulée.' }); router.refresh(); }
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
                      <div className="flex flex-col gap-1">
                        <StatutBadge statut={f.statut} />
                        {(() => {
                          const a = avoirsByFacture[f.id];
                          if (!a || a.totalEmis === 0) return null;
                          const ttc = Number(f.montant_ttc ?? 0);
                          // Si la facture est annulée + couverte 100% → "Annulée par avoir"
                          // Sinon partiel.
                          const fullyCovered = ttc > 0 && a.totalEmis + 0.005 >= ttc;
                          if (f.statut === 'annulee' && fullyCovered) {
                            return (
                              <span className="inline-block self-start text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-terra text-white" title={`Annulée par avoir (${a.totalEmis.toFixed(2)} €)`}>
                                ❌ Annulée par avoir
                              </span>
                            );
                          }
                          return (
                            <span className="inline-block self-start text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-terra-light text-terra border border-terra-mid" title={`Avoir partiel : ${a.totalEmis.toFixed(2)} € sur ${ttc.toFixed(2)} €`}>
                              📝 Avoir partiel
                            </span>
                          );
                        })()}
                      </div>
                    </td>
                    <td className="px-3.5 py-2.5 whitespace-nowrap">
                      <RowMenu
                        items={[
                          { icon: '✏️', label: 'Modifier', href: `/admin/facturation/${f.id}` },
                          { icon: '📄', label: 'Voir le PDF', href: `/api/admin/facture/${f.id}` },
                          {
                            icon: '✉️',
                            label: 'Marquer envoyée',
                            onClick: () => markEnvoyee(f.id),
                            hidden: f.statut !== 'brouillon',
                          },
                          {
                            icon: '✅',
                            label: 'Marquer payée',
                            onClick: () => markPaid(f.id),
                            hidden: f.statut === 'payee' || f.statut === 'annulee',
                          },
                          {
                            icon: '🗑️',
                            label: f.statut === 'brouillon' ? 'Supprimer' : 'Annuler la facture',
                            onClick: () => handleDelete(f),
                            destructive: true,
                          },
                        ]}
                      />
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
