'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { STATUT_INFO, STATUT_PIPELINE, type StatutIntervention } from '@/lib/types/database';
import { StatutBadge } from '@/components/StatutBadge';
import { fmtDateTime, relTime } from '@/lib/format';
import { useOrgType, useVocab } from '../PortalContext';
import type { InterventionListItem } from './page';

const STATUTS_FILTRE: ('tous' | StatutIntervention)[] = [
  'tous',
  ...STATUT_PIPELINE,
  'en_suspens',
];

export function InterventionsListClient({
  items,
  initialStatut,
  initialQuery,
  loadError,
}: {
  items: InterventionListItem[];
  initialStatut: string;
  initialQuery: string;
  loadError: string | null;
}) {
  const orgType = useOrgType();
  const v = useVocab();
  const isCourtier = orgType === 'courtier';
  const accentBg = isCourtier
    ? 'bg-[#1D6FA4] hover:bg-[#175E8E]'
    : 'bg-navy hover:bg-navy-mid';

  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<typeof STATUTS_FILTRE[number]>(
    (STATUTS_FILTRE as readonly string[]).includes(initialStatut)
      ? (initialStatut as typeof STATUTS_FILTRE[number])
      : 'tous',
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((iv) => {
      const matchQuery =
        !q ||
        [iv.ref, iv.acp_nom, iv.type, iv.description, iv.ref_courtier, iv.adresse, iv.assureur_nom]
          .filter(Boolean)
          .some((s) => String(s).toLowerCase().includes(q));
      const matchFilter = filter === 'tous' || iv.statut === filter;
      return matchQuery && matchFilter;
    });
  }, [items, query, filter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-ink">{v.myInterventions}</h1>
          <p className="text-xs text-ink-muted mt-0.5">
            {items.length} au total
          </p>
        </div>
        <Link
          href="/portal/nouveau"
          className={`text-white px-4 py-2.5 rounded-lg text-xs font-bold ${accentBg}`}
        >
          {v.newRequestVerb}
        </Link>
      </div>

      {loadError && (
        <div className="px-4 py-2.5 bg-amber-light border border-[#E8C896] text-[#8A5A1A] rounded-lg text-xs font-semibold">
          Connexion à la base limitée : {loadError}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={isCourtier
            ? 'Rechercher — référence FoxO, sinistre, assuré, compagnie, type…'
            : 'Rechercher — référence, ACP, type…'}
          className="flex-1 px-3.5 py-2.5 border border-sand-border rounded-lg text-xs bg-cream outline-none focus:border-navy-mid"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          className="px-3 py-2.5 border border-sand-border rounded-lg text-xs bg-cream cursor-pointer"
        >
          <option value="tous">Tous statuts</option>
          {STATUT_PIPELINE.map((s) => (
            <option key={s} value={s}>{STATUT_INFO[s].label}</option>
          ))}
          <option value="en_suspens">En suspens</option>
        </select>
      </div>

      {/* Mobile : cards */}
      <div className="md:hidden space-y-2">
        {filtered.length === 0 ? (
          <p className="text-xs text-ink-muted bg-cream border border-sand-border rounded-lg p-4 text-center">
            {v.emptyList}
          </p>
        ) : filtered.map((iv) => (
          <Link
            key={iv.id}
            href={`/portal/interventions/${iv.id}`}
            className="block bg-cream rounded-lg border border-sand-border p-3.5 hover:bg-sand-hover"
          >
            <div className="flex justify-between items-start gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-mono text-[11px] font-semibold text-navy">{iv.ref ?? '—'}</span>
                  {iv.ref_courtier && (
                    <span
                      className="font-mono text-[10px] font-semibold text-white rounded px-1.5 py-0.5"
                      style={{ background: '#1D6FA4' }}
                    >
                      {iv.ref_courtier}
                    </span>
                  )}
                </div>
                <div className="font-bold text-[13px] mt-0.5 truncate">{iv.acp_nom ?? '—'}</div>
                <div className="text-[11px] text-ink-muted mt-0.5">
                  {iv.type ?? '—'}
                  {iv.assureur_nom && <> · <span className="italic">{iv.assureur_nom}</span></>}
                </div>
              </div>
              <StatutBadge statut={iv.statut} />
            </div>
            <div className="flex justify-between items-center mt-2 text-[10px] text-ink-muted font-mono">
              <span>{fmtDateTime(iv.creneau_debut)}</span>
              <span>{relTime(iv.updated_at)}</span>
            </div>
          </Link>
        ))}
      </div>

      {/* Desktop : table */}
      <div className="hidden md:block bg-cream rounded-xl border border-sand-border overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-sand">
              {(isCourtier
                ? ['Réf. FoxO', 'Réf. courtier', v.acpLabel, 'Type', 'Créneau', 'Statut', 'Màj']
                : ['Réf.', v.acpLabel, 'Type', 'Créneau', 'Statut', 'Màj']
              ).map((h) => (
                <th
                  key={h}
                  className="px-3.5 py-2.5 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-sand-border whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={isCourtier ? 7 : 6} className="text-center py-12 text-ink-muted text-[13px]">
                  {v.emptyList}
                </td>
              </tr>
            ) : filtered.map((iv) => (
              <tr
                key={iv.id}
                className="border-b border-sand-mid hover:bg-sand-hover cursor-pointer"
                onClick={() => { window.location.href = `/portal/interventions/${iv.id}`; }}
              >
                <td className="px-3.5 py-3">
                  <span className="font-mono text-xs font-semibold text-navy">{iv.ref ?? '—'}</span>
                  {iv.priorite === 'urgente' && (
                    <span className="block mt-1 text-[9px] font-bold text-terra">⚡ URGENT</span>
                  )}
                </td>
                {isCourtier && (
                  <td className="px-3.5 py-3">
                    {iv.ref_courtier ? (
                      <>
                        <span
                          className="font-mono text-[11px] font-semibold text-white rounded px-2 py-0.5"
                          style={{ background: '#1D6FA4' }}
                        >
                          {iv.ref_courtier}
                        </span>
                        {iv.assureur_nom && (
                          <div className="text-[10px] text-ink-muted mt-0.5 truncate max-w-[160px]">
                            {iv.assureur_nom}
                          </div>
                        )}
                      </>
                    ) : <span className="text-ink-muted">—</span>}
                  </td>
                )}
                <td className="px-3.5 py-3 font-bold text-[13px]">{iv.acp_nom ?? '—'}</td>
                <td className="px-3.5 py-3 text-[11px] text-ink-mid whitespace-nowrap">{iv.type ?? '—'}</td>
                <td className="px-3.5 py-3 text-[11px] text-ink-mid font-mono whitespace-nowrap">
                  {fmtDateTime(iv.creneau_debut)}
                </td>
                <td className="px-3.5 py-3"><StatutBadge statut={iv.statut} /></td>
                <td className="px-3.5 py-3 text-[10px] text-ink-muted font-mono">
                  {relTime(iv.updated_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-ink-muted">
        {filtered.length} {v.countSuffix}
        {filtered.length !== items.length ? ` sur ${items.length}` : ''}
      </p>
    </div>
  );
}
