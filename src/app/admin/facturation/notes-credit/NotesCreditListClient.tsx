'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { Facture, StatutFacture } from '@/lib/types/database';

const STATUT_LABEL: Partial<Record<StatutFacture, string>> = {
  brouillon: 'Brouillon',
  envoyee:   'Émis',
  annulee:   'Annulé',
};

const STATUT_COLOR: Partial<Record<StatutFacture, { fg: string; bg: string }>> = {
  brouillon: { fg: '#6B6558', bg: '#EDEAE3' },
  envoyee:   { fg: '#2A5298', bg: '#D6E4F7' },
  annulee:   { fg: '#6B6558', bg: '#E4DFD4' },
};

function fmtMoney(n: number | null): string {
  if (n == null) return '—';
  return n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function NotesCreditListClient({
  initial,
  origineMap,
}: {
  initial: Facture[];
  origineMap: Record<string, string>;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return initial;
    return initial.filter((a) =>
      [a.numero, a.client_nom, a.reference, a.facture_origine_id ? origineMap[a.facture_origine_id] : null]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q)),
    );
  }, [initial, query, origineMap]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher — numéro, client, facture d'origine…"
          className="flex-1 min-w-[240px] px-3.5 py-2 border border-sand-border rounded-lg text-xs bg-cream outline-none focus:border-navy-mid"
        />
      </div>

      <div className="bg-cream border border-sand-border rounded-xl overflow-hidden dark:bg-[#1C1A16] dark:border-[#3D3A32]">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-sand dark:bg-[#221E1A]">
              {['N° avoir', 'Facture d\'origine', 'Client', 'Date', 'Montant TTC', 'Statut'].map((h) => (
                <th key={h} className="px-3.5 py-2.5 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-sand-border whitespace-nowrap dark:text-[#C8C2B8] dark:border-[#3D3A32]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-ink-muted text-[13px]">
                  Aucune note de crédit pour l&apos;instant. Crée un avoir depuis la fiche d&apos;une facture.
                </td>
              </tr>
            ) : filtered.map((a) => {
              const sc = STATUT_COLOR[a.statut] ?? { fg: '#6B6558', bg: '#EDEAE3' };
              const label = STATUT_LABEL[a.statut] ?? a.statut;
              const origNum = a.facture_origine_id ? origineMap[a.facture_origine_id] : null;
              return (
                <tr key={a.id} className="border-b border-sand-mid hover:bg-sand-hover dark:border-[#2C2A24] dark:hover:bg-[#221E1A]">
                  <td className="px-3.5 py-3 font-mono text-xs font-bold text-terra">
                    <Link href={`/admin/facturation/notes-credit/${a.id}`} className="hover:underline">
                      {a.numero}
                    </Link>
                  </td>
                  <td className="px-3.5 py-3 text-[12px]">
                    {a.facture_origine_id ? (
                      <Link href={`/admin/facturation/${a.facture_origine_id}`} className="font-mono text-navy hover:underline dark:text-[#A8C4F2]">
                        {origNum ?? '?'}
                      </Link>
                    ) : <span className="text-ink-muted">—</span>}
                  </td>
                  <td className="px-3.5 py-3 text-[12px]">{a.client_nom ?? '—'}</td>
                  <td className="px-3.5 py-3 text-[11px] font-mono text-ink-mid">{fmtDate(a.date_emission)}</td>
                  <td className="px-3.5 py-3 text-[12px] font-mono font-bold text-terra">{fmtMoney(a.montant_ttc)}</td>
                  <td className="px-3.5 py-3">
                    <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap" style={{ color: sc.fg, background: sc.bg }}>
                      {label}
                    </span>
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
