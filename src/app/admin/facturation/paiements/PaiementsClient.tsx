'use client';

import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Facture } from '@/lib/types/database';
import { importBeobankCsv } from '../actions';

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
      <section className="bg-cream rounded-xl border border-sand-border p-4 dark:bg-[#1C1A16] dark:border-[#3D3A32]">
        <h2 className="text-[13px] font-extrabold text-ink mb-1 dark:text-[#F0ECE4]">
          ⬇ Import Beobank CSV
        </h2>
        <p className="text-[11px] text-ink-muted mb-3 dark:text-[#C8C2B8]">
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
          className={
            'inline-block bg-[#A17244] text-white px-3.5 py-2.5 rounded-lg text-xs font-bold cursor-pointer ' +
            (pending ? 'opacity-50 pointer-events-none' : 'hover:opacity-90')
          }
        >
          {pending ? 'Import en cours…' : '📂 Choisir un fichier CSV'}
        </label>
        {feedback && (
          <div
            className={
              'mt-3 text-[12px] rounded-md px-3 py-2 border font-semibold ' +
              (feedback.kind === 'ok'
                ? 'bg-ok-light border-ok-mid text-ok'
                : 'bg-terra-light border-terra-mid text-terra')
            }
          >
            {feedback.msg}
          </div>
        )}
      </section>

      {/* En attente */}
      <section>
        <h2 className="text-[13px] font-extrabold text-ink mb-2 flex items-center gap-2 dark:text-[#F0ECE4]">
          ⏳ En attente de paiement
          <span className="text-[10px] font-bold text-ink-muted bg-sand-mid px-2 py-0.5 rounded-full dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8]">
            {enAttente.length}
          </span>
        </h2>
        {enAttente.length === 0 ? (
          <div className="bg-cream rounded-xl border border-sand-border p-6 text-center text-[12px] text-ink-muted dark:bg-[#1C1A16] dark:border-[#3D3A32] dark:text-[#C8C2B8]">
            Aucune facture en attente — tout est payé. 👍
          </div>
        ) : (
          <FactureTable rows={enAttente} todayIso={todayIso} showRetard />
        )}
      </section>

      {/* Récents paiements */}
      <section>
        <h2 className="text-[13px] font-extrabold text-ink mb-2 flex items-center gap-2 dark:text-[#F0ECE4]">
          ✅ Paiements récents
          <span className="text-[10px] font-bold text-ink-muted bg-sand-mid px-2 py-0.5 rounded-full dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8]">
            {recentes.length}
          </span>
        </h2>
        {recentes.length === 0 ? (
          <div className="bg-cream rounded-xl border border-sand-border p-6 text-center text-[12px] text-ink-muted dark:bg-[#1C1A16] dark:border-[#3D3A32] dark:text-[#C8C2B8]">
            Aucun paiement enregistré pour l&apos;instant.
          </div>
        ) : (
          <FactureTable rows={recentes} todayIso={todayIso} showPaiement />
        )}
      </section>
    </div>
  );
}

function FactureTable({
  rows, todayIso, showRetard, showPaiement,
}: {
  rows: FactureLite[];
  todayIso: string;
  showRetard?: boolean;
  showPaiement?: boolean;
}) {
  return (
    <div className="bg-cream rounded-xl border border-sand-border overflow-hidden dark:bg-[#1C1A16] dark:border-[#3D3A32]">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse min-w-[720px]">
          <thead>
            <tr className="bg-sand dark:bg-[#221E1A]">
              {[
                'N°', 'Client', 'Référence', 'Émission',
                ...(showRetard ? ['Échéance', 'Retard'] : []),
                ...(showPaiement ? ['Payée le'] : []),
                'TTC',
              ].map((h) => (
                <th key={h} className="px-3.5 py-2.5 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-sand-border whitespace-nowrap dark:text-[#C8C2B8] dark:border-[#3D3A32]">
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
                  <td className="px-3.5 py-2.5 text-[11px] text-ink-mid dark:text-[#C8C2B8]">{f.reference ?? '—'}</td>
                  <td className="px-3.5 py-2.5 text-[11px] text-ink-mid font-mono whitespace-nowrap dark:text-[#C8C2B8]">{fmtDate(f.date_emission)}</td>
                  {showRetard && (
                    <>
                      <td className="px-3.5 py-2.5 text-[11px] text-ink-mid font-mono whitespace-nowrap dark:text-[#C8C2B8]">{fmtDate(f.date_echeance)}</td>
                      <td className="px-3.5 py-2.5 whitespace-nowrap">
                        {retardJours > 0 ? (
                          <span className="inline-block text-[10px] font-bold rounded-full px-2 py-0.5 bg-terra-light text-terra border border-terra-mid">
                            {retardJours}j
                          </span>
                        ) : (
                          <span className="text-[10px] text-ink-muted dark:text-[#C8C2B8]">—</span>
                        )}
                      </td>
                    </>
                  )}
                  {showPaiement && (
                    <td className="px-3.5 py-2.5 text-[11px] text-ok font-mono whitespace-nowrap">{fmtDate(f.date_paiement)}</td>
                  )}
                  <td className="px-3.5 py-2.5 text-[12px] font-mono font-bold whitespace-nowrap dark:text-white">
                    {fmtMoney(f.montant_ttc)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
