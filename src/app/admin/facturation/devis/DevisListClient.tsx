'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Facture, StatutFacture } from '@/lib/types/database';
import { convertDevisToFacture } from '../actions';

const STATUT_LABEL: Record<StatutFacture, string> = {
  brouillon:  'Brouillon',
  envoyee:    'Envoyé',
  payee:      'Payé',
  en_retard:  'En retard',
  annulee:    'Annulé',
  accepte:    'Accepté',
  refuse:     'Refusé',
  expire:     'Expiré',
};

const STATUT_COLOR: Record<StatutFacture, { fg: string; bg: string }> = {
  brouillon:  { fg: '#6B6558', bg: '#EDEAE3' },
  envoyee:    { fg: '#2A5298', bg: '#D6E4F7' },
  accepte:    { fg: '#1F6B45', bg: '#D4EDE2' },
  refuse:     { fg: '#C4622D', bg: '#F7EDE5' },
  expire:     { fg: '#C4622D', bg: '#F7EDE5' },
  annulee:    { fg: '#6B6558', bg: '#E4DFD4' },
  payee:      { fg: '#1F6B45', bg: '#D4EDE2' },
  en_retard:  { fg: '#C4622D', bg: '#F7EDE5' },
};

function fmtMoney(n: number | null): string {
  if (n == null) return '—';
  return n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function DevisListClient({ initial }: { initial: Facture[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState('');
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return initial;
    return initial.filter((d) =>
      [d.numero, d.client_nom, d.reference]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q)),
    );
  }, [initial, query]);

  function convert(devisId: string, devisNumero: string) {
    if (!window.confirm(`Convertir le devis ${devisNumero} en facture ?\n\nLe devis passera en statut "Accepté" et une facture brouillon sera créée.`)) return;
    setFeedback(null);
    startTransition(async () => {
      const res = await convertDevisToFacture(devisId);
      if (!res.ok) {
        setFeedback({ kind: 'err', msg: res.error });
        return;
      }
      router.push(`/admin/facturation/${res.data!.id}`);
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher — numéro, client, référence…"
          className="flex-1 min-w-[240px] px-3.5 py-2 border border-sand-border rounded-lg text-xs bg-cream outline-none focus:border-navy-mid"
        />
      </div>

      {feedback && (
        <div className={
          'mb-3 px-3 py-2 text-xs rounded-md font-semibold ' +
          (feedback.kind === 'ok' ? 'bg-ok-light border border-ok-mid text-ok' : 'bg-terra-light border border-terra-mid text-terra')
        }>
          {feedback.msg}
        </div>
      )}

      <div className="bg-cream border border-sand-border rounded-xl overflow-hidden dark:bg-[#1C1A16] dark:border-[#3D3A32]">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-sand dark:bg-[#221E1A]">
              {['Numéro', 'Client', 'Émis le', 'Validité', 'Total TTC', 'Statut', ''].map((h) => (
                <th key={h} className="px-3.5 py-2.5 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-sand-border whitespace-nowrap dark:text-[#C8C2B8] dark:border-[#3D3A32]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-ink-muted text-[13px]">
                  Aucun devis pour l&apos;instant.
                </td>
              </tr>
            ) : filtered.map((d) => {
              const sc = STATUT_COLOR[d.statut];
              const dejaConverti = Boolean(d.converted_to_facture_id);
              return (
                <tr key={d.id} className="border-b border-sand-mid hover:bg-sand-hover dark:border-[#2C2A24] dark:hover:bg-[#221E1A]">
                  <td className="px-3.5 py-3 font-mono text-xs font-bold text-navy dark:text-[#A8C4F2]">
                    <Link href={`/admin/facturation/devis/${d.id}`} className="hover:underline">
                      {d.numero}
                    </Link>
                  </td>
                  <td className="px-3.5 py-3 text-[12px]">{d.client_nom ?? '—'}</td>
                  <td className="px-3.5 py-3 text-[11px] font-mono text-ink-mid">{fmtDate(d.date_emission)}</td>
                  <td className="px-3.5 py-3 text-[11px] font-mono text-ink-mid">{fmtDate(d.date_echeance)}</td>
                  <td className="px-3.5 py-3 text-[12px] font-mono font-bold">{fmtMoney(d.montant_ttc)}</td>
                  <td className="px-3.5 py-3">
                    <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap" style={{ color: sc.fg, background: sc.bg }}>
                      {STATUT_LABEL[d.statut]}
                    </span>
                  </td>
                  <td className="px-3.5 py-3 whitespace-nowrap">
                    {d.statut === 'accepte' && !dejaConverti && (
                      <button
                        type="button"
                        onClick={() => convert(d.id, d.numero)}
                        disabled={pending}
                        className="text-[10px] bg-ok text-white font-bold px-2 py-1 rounded hover:opacity-90 disabled:opacity-50"
                        title="Convertir en facture"
                      >
                        ↪ En facture
                      </button>
                    )}
                    {dejaConverti && d.converted_to_facture_id && (
                      <Link
                        href={`/admin/facturation/${d.converted_to_facture_id}`}
                        className="text-[10px] text-navy underline dark:text-[#A8C4F2]"
                      >
                        → Facture liée
                      </Link>
                    )}
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
