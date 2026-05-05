'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { STATUT_FACTURE_INFO, type Facture, type StatutFacture } from '@/lib/types/database';
import { RowMenu } from '@/components/RowMenu';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  createAvoirFromFacture,
  deleteFacture,
  revertToBrouillon,
} from './actions';

const STATUTS: ('tous' | StatutFacture)[] = ['tous', 'brouillon', 'envoyee', 'payee', 'en_retard', 'annulee'];

type Periode = 'tous' | 'this_month' | 'last_month' | 'this_quarter' | 'this_year' | 'last_year';
const PERIODE_LABEL: Record<Periode, string> = {
  tous:         'Toute la période',
  this_month:   'Ce mois',
  last_month:   'Mois dernier',
  this_quarter: 'Ce trimestre',
  this_year:    'Cette année',
  last_year:    'Année dernière',
};

// Retourne l'intervalle [from, to] (YYYY-MM-DD inclusif) correspondant
// à la période demandée — null = pas de filtre.
function getPeriodeRange(p: Periode): { from: string; to: string } | null {
  if (p === 'tous') return null;
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-11
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (p === 'this_month') {
    return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
  }
  if (p === 'last_month') {
    return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
  }
  if (p === 'this_quarter') {
    const qStart = Math.floor(m / 3) * 3; // 0,3,6,9
    return { from: iso(new Date(y, qStart, 1)), to: iso(new Date(y, qStart + 3, 0)) };
  }
  if (p === 'this_year') {
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  if (p === 'last_year') {
    return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
  }
  return null;
}

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

// Type d'action confirmable. Le menu remplit ce state, la modale l'affiche
// puis appelle l'action correspondante. Garde le menu lui-même léger.
type ConfirmKind = 'delete' | 'revert';
interface ConfirmState {
  kind: ConfirmKind;
  facture: Facture;
}

export function FacturationListClient({
  initialFactures,
  avoirsByFacture = {},
}: {
  initialFactures: Facture[];
  avoirsByFacture?: AvoirsAggByFacture;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<typeof STATUTS[number]>('tous');
  const [periode, setPeriode] = useState<Periode>('tous');

  // État local synchronisé avec la prop pour permettre les mises à jour
  // optimistes (suppression de ligne, transition de statut) sans attendre
  // un router.refresh(). Pattern officiel React 19 (« storing information
  // from previous renders ») : on stocke la dernière valeur de prop dans
  // un useState et on la compare en render ; si elle a changé, on reset
  // l'état local. Évite l'effet de bord d'un useEffect.
  const [factures, setFactures] = useState<Facture[]>(initialFactures);
  const [lastInit, setLastInit] = useState(initialFactures);
  if (lastInit !== initialFactures) {
    setLastInit(initialFactures);
    setFactures(initialFactures);
  }

  // Marque les factures dont l'échéance est dépassée ET non payées comme "en_retard"
  // côté UI (sans persister — l'admin peut explicitement marquer comme payée)
  const today = new Date().toISOString().slice(0, 10);
  const facturesView = useMemo(() => factures.map((f) => {
    if (f.statut === 'envoyee' && f.date_echeance && f.date_echeance < today) {
      return { ...f, statut: 'en_retard' as StatutFacture };
    }
    return f;
  }), [factures, today]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const range = getPeriodeRange(periode);
    return facturesView.filter((f) => {
      const matchQ = !q
        || f.numero.toLowerCase().includes(q)
        || (f.client_nom ?? '').toLowerCase().includes(q)
        || (f.reference ?? '').toLowerCase().includes(q);
      const matchF = filter === 'tous' || f.statut === filter;
      const matchP = !range
        || (f.date_emission !== null
            && f.date_emission >= range.from
            && f.date_emission <= range.to);
      return matchQ && matchF && matchP;
    });
  }, [facturesView, query, filter, periode]);

  // Stats
  const stats = useMemo(() => {
    const m = thisMonthRange();
    const monthRange = facturesView.filter((f) => f.date_emission && f.date_emission >= m.from && f.date_emission <= m.to);
    const totalMois = monthRange.reduce((s, f) => s + (f.montant_ttc ?? 0), 0);
    const enAttente = facturesView.filter((f) => f.statut === 'envoyee' || f.statut === 'en_retard').reduce((s, f) => s + (f.montant_ttc ?? 0), 0);
    const enRetard = facturesView.filter((f) => f.statut === 'en_retard').length;
    return { totalMois, enAttente, enRetard, count: monthRange.length };
  }, [facturesView]);

  function patchFacture(id: string, patch: Partial<Facture>) {
    setFactures((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  function performDelete(facture: Facture) {
    const snapshot = factures;
    // Optimistic : retire immédiatement.
    setFactures((prev) => prev.filter((f) => f.id !== facture.id));
    setConfirmState(null);
    startTransition(async () => {
      const res = await deleteFacture(facture.id);
      if (!res.ok) {
        setFactures(snapshot);
        setFeedback({ kind: 'err', msg: res.error });
        return;
      }
      setFeedback({ kind: 'ok', msg: `Brouillon ${facture.numero} supprimé.` });
    });
  }

  function performRevert(facture: Facture) {
    const previousStatut = facture.statut;
    patchFacture(facture.id, { statut: 'brouillon', sent_at: null, date_paiement: null });
    setConfirmState(null);
    startTransition(async () => {
      const res = await revertToBrouillon(facture.id);
      if (!res.ok) {
        patchFacture(facture.id, { statut: previousStatut });
        setFeedback({ kind: 'err', msg: res.error });
        return;
      }
      setFeedback({ kind: 'ok', msg: `${facture.numero} remise en brouillon.` });
    });
  }

  function handleCreateAvoir(facture: Facture) {
    setFeedback(null);
    startTransition(async () => {
      const res = await createAvoirFromFacture(facture.id);
      if (!res.ok) {
        setFeedback({ kind: 'err', msg: res.error });
        return;
      }
      router.push(`/admin/facturation/notes-credit/${res.data!.id}`);
    });
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <StatCard num={fmtMoney(stats.totalMois)} label={`Facturé ce mois (${stats.count})`} />
        <StatCard num={fmtMoney(stats.enAttente)} label="En attente de paiement" accent />
        <StatCard num={String(stats.enRetard)} label="En retard" warning={stats.enRetard > 0} />
        <StatCard num={String(facturesView.length)} label="Total chargé" muted />
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
        <select
          value={periode}
          onChange={(e) => setPeriode(e.target.value as Periode)}
          className="px-3 py-2.5 border border-sand-border rounded-lg text-xs bg-cream cursor-pointer"
          title="Filtre sur la date d'émission"
        >
          {(Object.entries(PERIODE_LABEL) as [Periode, string][]).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
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

      {/* Tableau — desktop only */}
      <div className="hidden md:block bg-cream rounded-xl border border-sand-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[860px]">
            <thead>
              <tr className="bg-sand">
                {['N°', 'Client', 'Référence', 'Émission', 'Échéance', 'HT', 'TVA', 'TTC', 'Statut', 'Actions'].map((h) => (
                  <th key={h} className="px-3.5 py-2.5 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-sand-border whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-12 text-ink-muted text-[13px]">
                    Aucune facture ne correspond au filtre.
                  </td>
                </tr>
              ) : (
                filtered.map((f) => (
                  <tr key={f.id} className="border-b border-sand-mid hover:bg-sand-hover">
                    <td className="px-3.5 py-2.5 whitespace-nowrap">
                      <Link
                        href={`/admin/facturation/${f.id}`}
                        className="font-mono text-xs font-bold text-navy hover:underline"
                      >
                        {f.numero}
                      </Link>
                    </td>
                    <td className="px-3.5 py-2.5">
                      <div className="text-xs font-semibold">{f.client_nom ?? '—'}</div>
                      {f.client_syndic && (
                        <div className="text-[10px] text-ink-muted">{f.client_syndic}</div>
                      )}
                    </td>
                    <td className="px-3.5 py-2.5 text-[11px] text-ink-mid">
                      {f.reference ?? '—'}
                    </td>
                    <td className="px-3.5 py-2.5 text-[11px] text-ink-mid font-mono whitespace-nowrap">
                      {fmtDate(f.date_emission)}
                    </td>
                    <td className="px-3.5 py-2.5 text-[11px] text-ink-mid font-mono whitespace-nowrap">
                      {fmtDate(f.date_echeance)}
                    </td>
                    <td className="px-3.5 py-2.5 text-[11px] font-mono whitespace-nowrap">
                      {fmtMoney(f.montant_ht)}
                    </td>
                    <td className="px-3.5 py-2.5 text-[11px] font-mono whitespace-nowrap text-ink-mid">
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
                        direction="up"
                        items={[
                          { icon: '✏️', label: 'Modifier', href: `/admin/facturation/${f.id}` },
                          { icon: '📄', label: 'Voir le PDF', href: `/api/admin/facture/${f.id}` },
                          {
                            icon: '📝',
                            label: 'Créer un avoir',
                            onClick: () => handleCreateAvoir(f),
                            hidden: f.statut === 'annulee',
                            disabled: pending,
                          },
                          {
                            icon: '↩',
                            label: 'Remettre en brouillon',
                            onClick: () => setConfirmState({ kind: 'revert', facture: f }),
                            hidden: f.statut !== 'envoyee',
                          },
                          {
                            icon: '🗑️',
                            label: 'Supprimer',
                            onClick: () => setConfirmState({ kind: 'delete', facture: f }),
                            hidden: f.statut !== 'brouillon',
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

      {/* Cards mobile (< 768px) — version condensée. Le clic ouvre la
          fiche détail (où on retrouve les actions avoir/revert/delete). */}
      <div className="md:hidden space-y-2">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-ink-muted text-[13px] bg-cream rounded-xl border border-sand-border">
            Aucune facture ne correspond au filtre.
          </div>
        ) : (
          filtered.map((f) => {
            const a = avoirsByFacture[f.id];
            const ttc = Number(f.montant_ttc ?? 0);
            const fullyCovered = a && a.totalEmis > 0 && ttc > 0 && a.totalEmis + 0.005 >= ttc;
            return (
              <Link
                key={f.id}
                href={`/admin/facturation/${f.id}`}
                className="block bg-cream rounded-xl border border-sand-border p-3 hover:bg-sand-hover transition-colors"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="font-mono text-[12px] font-bold text-navy">
                    {f.numero}
                  </span>
                  <StatutBadge statut={f.statut} />
                </div>

                <div className="text-[13px] font-semibold text-ink truncate">
                  {f.client_nom ?? '—'}
                </div>
                {f.client_syndic && (
                  <div className="text-[10px] text-ink-muted truncate">
                    {f.client_syndic}
                  </div>
                )}
                {f.reference && (
                  <div className="text-[10px] text-ink-mid mt-0.5">
                    Réf : <span className="font-mono">{f.reference}</span>
                  </div>
                )}

                {a && a.totalEmis > 0 && (
                  <div className="mt-1.5">
                    {f.statut === 'annulee' && fullyCovered ? (
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-terra text-white">
                        ❌ Annulée par avoir
                      </span>
                    ) : (
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-terra-light text-terra border border-terra-mid">
                        📝 Avoir partiel ({a.totalEmis.toFixed(2)} €)
                      </span>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-sand-mid">
                  <div>
                    <div className="text-[9px] font-bold text-ink-muted uppercase tracking-wider">Émission</div>
                    <div className="text-[11px] font-mono">{fmtDate(f.date_emission)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] font-bold text-ink-muted uppercase tracking-wider">Échéance</div>
                    <div className="text-[11px] font-mono">{fmtDate(f.date_echeance)}</div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-[9px] font-bold text-ink-muted uppercase tracking-wider">TTC</div>
                    <div className="text-[16px] font-mono font-bold text-ink dark:text-white">
                      {fmtMoney(f.montant_ttc)}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>

      <ConfirmDialog
        open={confirmState !== null}
        title={
          confirmState?.kind === 'delete'
            ? `Supprimer le brouillon ${confirmState.facture.numero} ?`
            : confirmState?.kind === 'revert'
            ? `Remettre ${confirmState?.facture.numero} en brouillon ?`
            : ''
        }
        message={
          confirmState?.kind === 'delete'
            ? 'Le brouillon sera supprimé (soft delete : conservé en historique mais masqué).'
            : confirmState?.kind === 'revert'
            ? 'La facture repassera en brouillon. La date d\'envoi sera effacée — tu pourras la rééditer puis la renvoyer.'
            : ''
        }
        confirmLabel={confirmState?.kind === 'delete' ? 'Supprimer' : 'Remettre en brouillon'}
        destructive={confirmState?.kind === 'delete'}
        pending={pending}
        onConfirm={() => {
          if (!confirmState) return;
          if (confirmState.kind === 'delete') performDelete(confirmState.facture);
          else performRevert(confirmState.facture);
        }}
        onCancel={() => setConfirmState(null)}
      />
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
  if (muted) numColor = 'text-ink-mid';
  if (warning) { bg = 'bg-terra-light'; border = 'border-terra-mid'; numColor = 'text-terra dark:text-white'; }
  return (
    <div className={`${bg} ${border} border rounded-xl px-4 py-3`}>
      <div className={`text-[18px] font-extrabold leading-tight ${numColor || 'stat-num'}`}>{num}</div>
      <div className="text-[10px] text-ink-muted mt-1 font-semibold">{label}</div>
    </div>
  );
}
