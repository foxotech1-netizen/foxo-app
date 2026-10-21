'use client';

import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download, FolderOpen, Hourglass, ThumbsUp, CheckCircle2, Undo2 } from 'lucide-react';
import type { Facture } from '@/lib/types/database';
import { importBeobankCsv, setFactureStatut } from '../actions';

type FactureLite = Pick<Facture, 'id' | 'numero' | 'client_nom' | 'client_syndic' | 'reference' | 'montant_ttc' | 'date_emission' | 'date_echeance' | 'date_paiement' | 'statut' | 'sent_at'>;

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtMoney(n: number | null | undefined): string {
  const v = typeof n === 'number' ? n : 0;
  return v.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function daysBetween(fromIso: string, toIso: string): number {
  const f = new Date(fromIso);
  const t = new Date(toIso);
  return Math.floor((t.getTime() - f.getTime()) / 86_400_000);
}

export function PaiementsClient({
  recentes, enAttente, todayIso,
}: {
  recentes: FactureLite[];
  enAttente: FactureLite[];
  todayIso: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const csvFileRef = useRef<HTMLInputElement>(null);

  // Retire un paiement enregistré par erreur : la facture repasse
  // « envoyée » et sa date de paiement est effacée (setFactureStatut).
  function retirerPaiement(f: FactureLite) {
    if (!confirm(`Retirer le paiement de ${f.numero} ?\n\nLa facture repassera « envoyée » et la date de paiement sera effacée.`)) return;
    setFeedback(null);
    startTransition(async () => {
      const res = await setFactureStatut(f.id, 'envoyee');
      if (!res.ok) { setFeedback({ kind: 'err', msg: res.error }); return; }
      setFeedback({ kind: 'ok', msg: `Paiement retiré — ${f.numero} repasse en attente.` });
      router.refresh();
    });
  }

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

  return (
    <div className="space-y-6">
      {/* Import Beobank */}
      <section className="bg-cream rounded-xl border border-sand-border p-4">
        <h2 className="fxs-block-title text-ink mb-1 inline-flex items-center gap-1.5">
          <Download size={14} aria-hidden /> Import Beobank CSV
        </h2>
        <p className="fx-small text-ink-mid mb-3">
          Charge l&apos;export CSV de ton compte Beobank — les transactions
          dont la communication structurée matche une facture seront marquées
          payées automatiquement.
        </p>
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
          className={'fx-label inline-flex items-center gap-1.5 bg-navy text-cream px-3.5 py-2.5 rounded-lg font-semibold cursor-pointer ' +
            (pending ? 'opacity-50 pointer-events-none' : 'hover:opacity-90')
          }
        >
          {pending ? 'Import en cours…' : (<><FolderOpen size={14} aria-hidden /> Choisir un fichier CSV</>)}
        </label>
        {feedback && (
          <div
            className={'fx-label mt-3 rounded-lg px-3 py-2 border font-semibold ' +
              (feedback.kind === 'ok'
                ? 'bg-ok-light border-ok-mid text-ok'
                : 'bg-terra-light border-terra-mid text-terra-ink')
            }
          >
            {feedback.msg}
          </div>
        )}
      </section>

      {/* En attente */}
      <section>
        <h2 className="fxs-block-title text-ink mb-2 flex items-center gap-2">
          <Hourglass size={14} aria-hidden /> En attente de paiement
          <span className="fx-badge font-semibold text-ink-mid bg-sand-mid px-2 py-0.5 rounded-full">
            {enAttente.length}
          </span>
        </h2>
        {enAttente.length === 0 ? (
          <div className="fx-meta bg-cream rounded-xl border border-sand-border p-6 text-center text-ink-mid inline-flex items-center justify-center gap-1.5 w-full">
            Aucune facture en attente — tout est payé. <ThumbsUp size={14} aria-hidden />
          </div>
        ) : (
          <FactureTable rows={enAttente} todayIso={todayIso} showRetard />
        )}
      </section>

      {/* Récents paiements */}
      <section>
        <h2 className="fxs-block-title text-ink mb-2 flex items-center gap-2">
          <CheckCircle2 size={14} aria-hidden /> Paiements récents
          <span className="fx-badge font-semibold text-ink-mid bg-sand-mid px-2 py-0.5 rounded-full">
            {recentes.length}
          </span>
        </h2>
        {recentes.length === 0 ? (
          <div className="fx-meta bg-cream rounded-xl border border-sand-border p-6 text-center text-ink-mid">
            Aucun paiement enregistré pour l&apos;instant.
          </div>
        ) : (
          <FactureTable rows={recentes} todayIso={todayIso} showPaiement onRetirer={retirerPaiement} retirerPending={pending} />
        )}
      </section>
    </div>
  );
}

function FactureTable({
  rows, todayIso, showRetard, showPaiement, onRetirer, retirerPending,
}: {
  rows: FactureLite[];
  todayIso: string;
  showRetard?: boolean;
  showPaiement?: boolean;
  onRetirer?: (f: FactureLite) => void;
  retirerPending?: boolean;
}) {
  return (
    <div className="bg-cream rounded-xl border border-sand-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse min-w-[720px]">
          <thead>
            <tr className="bg-sand">
              {[ 'N°', 'Client', 'Référence', 'Émission',
                ...(showRetard ? ['Échéance', 'Retard'] : []),
                ...(showPaiement ? ['Payée le'] : []), 'TTC',
                ...(onRetirer ? [''] : []),
              ].map((h) => (
                <th key={h} className="fx-eyebrow px-3.5 py-2.5 text-left font-semibold text-ink-mid border-b border-sand-border whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => {
              const retardJours = showRetard && f.date_echeance
                ? Math.max(0, daysBetween(f.date_echeance, todayIso))
                : 0;
              return (
                <tr key={f.id} className="border-b border-sand-mid hover:bg-sand-hover">
                  <td className="px-3.5 py-2.5 whitespace-nowrap">
                    <Link
                      href={`/admin/facturation/${f.id}`}
                      className="fx-label fx-ref font-semibold text-navy hover:underline"
                    >
                      {f.numero}
                    </Link>
                  </td>
                  <td className="px-3.5 py-2.5">
                    <div className="fx-label font-semibold">{f.client_nom ?? '—'}</div>
                    {f.client_syndic && (
                      <div className="fx-small text-ink-mid">{f.client_syndic}</div>
                    )}
                  </td>
                  <td className="fx-small px-3.5 py-2.5 text-ink-mid">{f.reference ?? '—'}</td>
                  <td className="fx-small px-3.5 py-2.5 text-ink-mid tabular-nums whitespace-nowrap">{fmtDate(f.date_emission)}</td>
                  {showRetard && (
                    <>
                      <td className="fx-small px-3.5 py-2.5 text-ink-mid tabular-nums whitespace-nowrap">{fmtDate(f.date_echeance)}</td>
                      <td className="px-3.5 py-2.5 whitespace-nowrap">
                        {retardJours > 0 ? (
                          <span className="fx-badge inline-block font-semibold rounded-full px-2 py-0.5 bg-terra-light text-terra-ink border border-terra-mid">
                            {retardJours}j
                          </span>
                        ) : (
                          <span className="fx-small text-ink-mid">—</span>
                        )}
                      </td>
                    </>
                  )}
                  {showPaiement && (
                    <td className="fx-small px-3.5 py-2.5 text-ok tabular-nums whitespace-nowrap">{fmtDate(f.date_paiement)}</td>
                  )}
                  <td className="fx-body-dense px-3.5 py-2.5 tabular-nums font-semibold whitespace-nowrap">
                    {fmtMoney(f.montant_ttc)}
                  </td>
                  {onRetirer && (
                    <td className="px-3.5 py-2.5 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onRetirer(f)}
                        disabled={retirerPending}
                        title="Retirer le paiement — la facture repasse « envoyée », la date de paiement est effacée."
                        className="fx-small font-semibold text-ink-mid hover:text-terra-ink inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        <Undo2 size={12} aria-hidden /> Retirer
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
