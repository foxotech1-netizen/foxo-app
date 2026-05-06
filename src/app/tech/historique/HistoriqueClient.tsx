'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Camera, ClipboardList, FileEdit, Zap } from 'lucide-react';
import { StatutBadge } from '@/components/StatutBadge';
import type { PrioriteIntervention, StatutIntervention } from '@/lib/types/database';

export interface MissionRow {
  id: string;
  ref: string | null;
  statut: StatutIntervention;
  priorite: PrioriteIntervention;
  type: string | null;
  creneau_debut: string | null;
  ended_at: string | null;
  updated_at: string;
  adresse: string | null;
  acp_nom: string | null;
  acp_ville: string | null;
  syndic_nom: string | null;
  client_label: string;
  photo_count: number;
  has_rapport: boolean;
}

type Filter = 'tous' | 'mois' | 'en_cours' | 'termine';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function isThisMonth(iso: string | null, ref: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
}

export function HistoriqueClient({ rows }: { rows: MissionRow[] }) {
  const [filter, setFilter] = useState<Filter>('tous');
  const [query, setQuery] = useState('');

  const now = useMemo(() => new Date(), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      // Filtre statut
      if (filter === 'mois' && !isThisMonth(r.creneau_debut ?? r.updated_at, now)) return false;
      if (filter === 'en_cours' && r.statut !== 'confirmee' && r.statut !== 'realisee') return false;
      if (filter === 'termine' && r.statut !== 'rapport' && r.statut !== 'cloturee') return false;
      // Recherche
      if (q) {
        const hay = [r.ref, r.client_label, r.acp_nom, r.acp_ville, r.adresse, r.syndic_nom]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, filter, query, now]);

  const counts = useMemo(() => ({
    tous: rows.length,
    mois: rows.filter((r) => isThisMonth(r.creneau_debut ?? r.updated_at, now)).length,
    en_cours: rows.filter((r) => r.statut === 'confirmee' || r.statut === 'realisee').length,
    termine: rows.filter((r) => r.statut === 'rapport' || r.statut === 'cloturee').length,
  }), [rows, now]);

  return (
    <div className="space-y-3">
      <header>
        <h1 className="text-xl font-display font-extrabold text-[var(--text-primary)] inline-flex items-center gap-2"><ClipboardList size={18} />Historique</h1>
        <p className="text-[11px] text-[var(--text-3)] mt-1">{rows.length} intervention{rows.length !== 1 ? 's' : ''} au total</p>
      </header>

      {/* Recherche */}
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Rechercher (référence, client, ACP…)"
        className="w-full px-3 py-2.5 border border-[var(--card-border)] rounded-lg text-[13px] bg-[var(--card-bg)] text-[var(--text-primary)] outline-none focus:border-[#34D399]"
      />

      {/* Filtres */}
      <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-1">
        {([
          { v: 'tous' as const,     label: 'Toutes',    n: counts.tous },
          { v: 'mois' as const,     label: 'Ce mois',   n: counts.mois },
          { v: 'en_cours' as const, label: 'En cours',  n: counts.en_cours },
          { v: 'termine' as const,  label: 'Terminées', n: counts.termine },
        ]).map((opt) => (
          <button
            key={opt.v}
            type="button"
            onClick={() => setFilter(opt.v)}
            className={
              'flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors ' +
              (filter === opt.v
                ? 'bg-[#34D399] text-white'
                : 'bg-[var(--card-bg)] text-[var(--text-2)] border border-[var(--card-border)] hover:border-[#34D399]')
            }
          >
            {opt.label} <span className="opacity-70">{opt.n}</span>
          </button>
        ))}
      </div>

      {/* Liste */}
      {filtered.length === 0 ? (
        <div className="premium-card p-6 text-center text-[13px] text-[var(--text-2)]">
          Aucune intervention ne correspond aux critères.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((m) => <MissionCard key={m.id} m={m} />)}
        </div>
      )}
    </div>
  );
}

function MissionCard({ m }: { m: MissionRow }) {
  return (
    <Link
      href={`/tech/interventions/${m.id}`}
      className="block premium-card p-3"
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-mono text-[11px] font-semibold" style={{ color: '#34D399' }}>
            {m.ref ?? '—'}
          </span>
          <span className="text-[10px] font-mono text-[var(--text-3)]">
            {fmtDate(m.creneau_debut ?? m.updated_at)}
          </span>
          {m.priorite === 'urgente' && (
            <span className="text-[9px] font-bold text-terra bg-terra-light border border-terra-mid rounded-full px-1.5 py-0.5 inline-flex items-center">
              <Zap size={10} />
            </span>
          )}
        </div>
        <StatutBadge statut={m.statut} />
      </div>
      <div className="font-bold text-[13px] text-[var(--text-primary)]">{m.client_label}</div>
      {(m.acp_ville || m.adresse) && (
        <div className="text-[11px] text-[var(--text-2)] mt-0.5">
          {[m.adresse, m.acp_ville].filter(Boolean).join(' · ')}
        </div>
      )}
      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-[var(--text-3)]">
        {m.type && <span>{m.type}</span>}
        {m.photo_count > 0 && (
          <span className="font-bold inline-flex items-center gap-1"><Camera size={12} />{m.photo_count}</span>
        )}
        {m.has_rapport && (
          <span className="font-bold text-ok inline-flex items-center gap-1"><FileEdit size={12} />rapport</span>
        )}
      </div>
    </Link>
  );
}
