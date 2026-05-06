'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Zap, FileText, MapPin, Wrench } from 'lucide-react';
import type { StatutIntervention } from '@/lib/types/database';
import { StatutBadge } from '@/components/StatutBadge';
import { fmtDate, fmtDateTime, relTime } from '@/lib/format';
import { useOrgType, useVocab } from '../PortalContext';
import type { InterventionPortalItem } from './page';

// Chips de filtre rapide. La fonction `match` est évaluée sur chaque
// item dans le useMemo de filtrage. L'ordre est l'ordre d'affichage.
type ChipId = 'tous' | 'enCours' | 'enAttente' | 'rapportPret' | 'cloture';
interface Chip {
  id: ChipId;
  label: string;
  match: (s: StatutIntervention) => boolean;
}
const CHIPS: Chip[] = [
  { id: 'tous',       label: 'Tous',           match: () => true },
  { id: 'enCours',    label: 'En cours',       match: (s) => s === 'nouvelle' || s === 'confirmee' || s === 'realisee' },
  { id: 'enAttente',  label: 'En attente',     match: (s) => s === 'attente' || s === 'en_suspens' },
  { id: 'rapportPret', label: 'Rapport prêt',  match: (s) => s === 'rapport' },
  { id: 'cloture',    label: 'Clôturé',        match: (s) => s === 'cloturee' },
];

// Mappe un searchParam ?statut=… legacy vers une chip pour compat avec
// les anciens liens (ex: bandeau dashboard "rapports disponibles").
function chipFromStatutParam(s: string | null): ChipId {
  if (!s) return 'tous';
  if (s === 'rapport') return 'rapportPret';
  if (s === 'cloturee') return 'cloture';
  if (s === 'nouvelle' || s === 'confirmee' || s === 'realisee') return 'enCours';
  if (s === 'attente' || s === 'en_suspens') return 'enAttente';
  return 'tous';
}

export function InterventionsPortalClient({
  items,
  initialQuery,
  initialStatut,
  loadError,
}: {
  items: InterventionPortalItem[];
  initialQuery: string;
  initialStatut: string | null;
  loadError: string | null;
}) {
  const orgType = useOrgType();
  const v = useVocab();
  const isCourtier = orgType === 'courtier';
  const accentBg = isCourtier
    ? 'bg-[#1D6FA4] hover:bg-[#175E8E]'
    : 'bg-navy hover:bg-navy-mid';

  const [query, setQuery] = useState(initialQuery);
  const [chip, setChip] = useState<ChipId>(chipFromStatutParam(initialStatut));

  const activeChip = CHIPS.find((c) => c.id === chip) ?? CHIPS[0];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((iv) => {
      // Filtre chip (statut)
      if (!activeChip.match(iv.statut)) return false;
      // Filtre recherche multi-champs : ref, ACP, adresse, BCE, ref courtier
      if (!q) return true;
      const haystack = [
        iv.ref,
        iv.acp_nom,
        iv.acp_adresse,
        iv.adresse,
        iv.acp_bce,
        iv.ref_courtier,
        iv.assureur_nom,
        iv.type,
      ]
        .filter(Boolean)
        .map((s) => String(s).toLowerCase())
        .join(' ');
      return haystack.includes(q);
    });
  }, [items, query, activeChip]);

  // Compte par chip pour afficher les totaux dans les boutons.
  const counts = useMemo(() => {
    const out: Record<ChipId, number> = {
      tous: items.length,
      enCours: 0,
      enAttente: 0,
      rapportPret: 0,
      cloture: 0,
    };
    for (const iv of items) {
      for (const c of CHIPS) {
        if (c.id !== 'tous' && c.match(iv.statut)) out[c.id] += 1;
      }
    }
    return out;
  }, [items]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-ink">{v.myInterventions}</h1>
          <p className="text-xs text-ink-muted mt-0.5">{items.length} au total</p>
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

      {/* Barre de recherche */}
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={isCourtier
          ? 'Rechercher — référence, assuré, adresse, BCE, sinistre…'
          : 'Rechercher — référence, ACP, adresse, BCE…'}
        className="w-full px-3.5 py-2.5 border border-sand-border rounded-lg text-xs bg-cream outline-none focus:border-navy-mid"
      />

      {/* Chips filtres rapides */}
      <div className="flex flex-wrap gap-1.5">
        {CHIPS.map((c) => {
          const active = c.id === chip;
          const n = counts[c.id];
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setChip(c.id)}
              className={
                'text-[11px] font-bold px-3 py-1.5 rounded-full border transition-colors ' +
                (active
                  ? 'bg-navy text-white border-navy'
                  : 'bg-cream text-ink-mid border-sand-border hover:bg-sand-mid')
              }
            >
              {c.label}
              <span className={'ml-1.5 text-[10px] font-semibold ' + (active ? 'opacity-80' : 'opacity-60')}>
                ({n})
              </span>
            </button>
          );
        })}
      </div>

      {/* Mobile : cards */}
      <div className="md:hidden space-y-2">
        {filtered.length === 0 ? (
          <p className="text-xs text-ink-muted bg-cream border border-sand-border rounded-lg p-6 text-center">
            {v.emptyList}
          </p>
        ) : filtered.map((iv) => (
          <Link
            key={iv.id}
            href={`/portal/interventions/${iv.id}`}
            className="block bg-cream rounded-lg border border-sand-border p-3.5 hover:bg-sand-hover"
          >
            <div className="flex justify-between items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-mono text-[11px] font-semibold text-navy">{iv.ref ?? '—'}</span>
                  {iv.priorite === 'urgente' && (
                    <span className="inline-flex items-center gap-1 text-[9px] font-bold text-terra"><Zap size={12} /> URGENT</span>
                  )}
                  {iv.has_rapport && (
                    <span className="inline-flex items-center gap-1 text-[9px] font-bold text-ok"><FileText size={12} /> Rapport</span>
                  )}
                </div>
                <div className="font-bold text-[13px] mt-0.5 truncate">{iv.acp_nom ?? '—'}</div>
                {(iv.acp_adresse || iv.adresse) && (
                  <div className="inline-flex items-center gap-1.5 text-[11px] text-ink-mid mt-0.5 truncate">
                    <MapPin size={12} /> {iv.acp_adresse ?? iv.adresse}
                  </div>
                )}
                <div className="text-[10px] text-ink-muted mt-1 flex items-center gap-2 flex-wrap">
                  <span>Créé {fmtDate(iv.created_at)}</span>
                  {iv.technicien_nom && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1"><Wrench size={12} /> {iv.technicien_nom}</span>
                    </>
                  )}
                </div>
              </div>
              <StatutBadge statut={iv.statut} />
            </div>
            {iv.creneau_debut && (
              <div className="mt-2 text-[10px] text-ink-muted font-mono">
                Créneau : {fmtDateTime(iv.creneau_debut)}
              </div>
            )}
          </Link>
        ))}
      </div>

      {/* Desktop : table */}
      <div className="hidden md:block bg-cream rounded-xl border border-sand-border overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-sand">
              {[
                { key: 'ref', node: 'Réf.' },
                { key: 'acp', node: v.acpLabel },
                { key: 'adresse', node: 'Adresse' },
                { key: 'statut', node: 'Statut' },
                { key: 'cree', node: 'Créé le' },
                { key: 'tech', node: 'Technicien' },
                { key: 'rapport', node: <FileText size={14} /> },
              ].map((h) => (
                <th
                  key={h.key}
                  className="px-3.5 py-2.5 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-sand-border whitespace-nowrap"
                >
                  {h.node}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-ink-muted text-[13px]">
                  {v.emptyList}
                </td>
              </tr>
            ) : filtered.map((iv) => (
              <tr
                key={iv.id}
                className="border-b border-sand-mid hover:bg-sand-hover cursor-pointer"
                onClick={() => { window.location.href = `/portal/interventions/${iv.id}`; }}
              >
                <td className="px-3.5 py-3 whitespace-nowrap">
                  <span className="font-mono text-xs font-semibold text-navy">{iv.ref ?? '—'}</span>
                  {iv.priorite === 'urgente' && (
                    <span className="inline-flex items-center gap-1 mt-1 text-[9px] font-bold text-terra"><Zap size={12} /> URGENT</span>
                  )}
                </td>
                <td className="px-3.5 py-3">
                  <div className="font-bold text-[13px]">{iv.acp_nom ?? '—'}</div>
                  {iv.acp_bce && (
                    <div className="text-[10px] text-ink-muted font-mono mt-0.5">BCE {iv.acp_bce}</div>
                  )}
                </td>
                <td className="px-3.5 py-3 text-[11px] text-ink-mid">
                  {iv.acp_adresse ?? iv.adresse ?? <span className="text-ink-muted">—</span>}
                </td>
                <td className="px-3.5 py-3"><StatutBadge statut={iv.statut} /></td>
                <td className="px-3.5 py-3 text-[11px] text-ink-mid font-mono whitespace-nowrap">
                  {fmtDate(iv.created_at)}
                  <div className="text-[10px] text-ink-muted">{relTime(iv.updated_at)}</div>
                </td>
                <td className="px-3.5 py-3 text-[11px] text-ink-mid whitespace-nowrap">
                  {iv.technicien_nom ?? <span className="text-ink-muted italic">Non assigné</span>}
                </td>
                <td className="px-3.5 py-3 text-center">
                  {iv.has_rapport && (
                    <span className="inline-flex" title="Rapport disponible"><FileText size={14} /></span>
                  )}
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
