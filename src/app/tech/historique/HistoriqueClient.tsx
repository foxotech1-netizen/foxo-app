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
    <div className="space-y-4">
      <header className="pb-3.5 border-b border-[var(--color-sand-border)]">
        <h1 className="font-sora text-[24px] font-semibold tracking-tight text-[var(--color-ink)] inline-flex items-center gap-2">
          <ClipboardList size={20} className="text-[var(--accent-tech)]" />Historique
        </h1>
        <div className="flex items-center gap-2 text-[12px] text-[var(--color-ink-mid)] tracking-wide mt-1">
          <span className="w-1 h-1 rounded-full bg-[var(--accent-tech)]"></span>
          {rows.length} intervention{rows.length !== 1 ? 's' : ''} au total
        </div>
      </header>

      {/* Recherche */}
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Rechercher (référence, client, ACP…)"
        className="w-full px-3.5 py-3 border border-[var(--color-sand-border)] rounded-lg text-[14px] bg-[var(--color-cream)] text-[var(--color-ink)] outline-none focus:border-[var(--accent-tech)] min-h-[44px]"
      />

      {/* Filtres — pills tactiles */}
      <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1">
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
              'flex-shrink-0 px-3.5 py-2 rounded-full text-[13px] font-semibold transition-colors min-h-[40px] ' +
              (filter === opt.v
                ? 'bg-[var(--accent-tech)] text-[var(--color-cream)]'
                : 'bg-[var(--color-cream)] text-[var(--color-ink)] border border-[var(--color-sand-border)] hover:border-[var(--accent-tech)]')
            }
          >
            {opt.label} <span className="opacity-70">{opt.n}</span>
          </button>
        ))}
      </div>

      {/* Liste */}
      {filtered.length === 0 ? (
        <div
          className="bg-[var(--color-cream)] rounded-xl p-6 text-center text-[14px] text-[var(--color-ink-mid)]"
          style={{ boxShadow: '0 1px 2px rgba(15,32,64,0.04), 0 4px 12px rgba(15,32,64,0.05), 0 0 0 1px rgba(15,32,64,0.04)' }}
        >
          Aucune intervention ne correspond aux critères.
        </div>
      ) : (
        <div className="space-y-3">
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
      className="block bg-[var(--color-cream)] rounded-xl p-4 transition-all active:scale-[0.99] min-h-[44px]"
      style={{ boxShadow: '0 1px 2px rgba(15,32,64,0.04), 0 4px 12px rgba(15,32,64,0.05), 0 0 0 1px rgba(15,32,64,0.04)' }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-sora text-[12px] font-semibold tracking-[0.01em] text-[var(--accent-tech)]">
            {m.ref ?? '—'}
          </span>
          <span className="text-[11px] font-mono text-[var(--color-ink-mid)]">
            {fmtDate(m.creneau_debut ?? m.updated_at)}
          </span>
          {m.priorite === 'urgente' && (
            <span className="text-[11px] font-semibold text-[var(--color-terra)] bg-[var(--color-terra-light)] border border-[var(--color-terra-mid)] rounded-full px-2 py-0.5 inline-flex items-center gap-1">
              <Zap size={11} />
            </span>
          )}
        </div>
        <StatutBadge statut={m.statut} />
      </div>
      <div className="font-semibold text-[14px] text-[var(--color-ink)]">{m.client_label}</div>
      {(m.acp_ville || m.adresse) && (
        <div className="text-[12px] text-[var(--color-ink)] mt-1">
          {[m.adresse, m.acp_ville].filter(Boolean).join(' · ')}
        </div>
      )}
      <div className="flex items-center gap-3 mt-2 text-[11px] text-[var(--color-ink-mid)]">
        {m.type && <span>{m.type}</span>}
        {m.photo_count > 0 && (
          <span className="font-semibold inline-flex items-center gap-1"><Camera size={13} />{m.photo_count}</span>
        )}
        {m.has_rapport && (
          <span className="font-semibold text-[var(--color-ok)] inline-flex items-center gap-1"><FileEdit size={13} />rapport</span>
        )}
      </div>
    </Link>
  );
}
