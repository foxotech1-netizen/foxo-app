'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';

const SyndicMap = dynamic(() => import('./SyndicMap'), { ssr: false });

type MapPin = {
  id: string;
  lat: number;
  lng: number;
  ref: string | null;
  acp_nom: string;
  statut: string;
  priorite?: string;
  type: string | null;
};

type FilterKey = 'toutes' | 'en_cours' | 'nouvelles' | 'rapport' | 'urgentes';

const FILTERS: { key: FilterKey; label: string; color: string }[] = [
  { key: 'toutes',    label: 'Toutes',        color: '#6B7280' },
  { key: 'en_cours',  label: 'En cours',      color: '#60A5FA' },
  { key: 'nouvelles', label: 'Nouvelles',     color: '#FBBF24' },
  { key: 'rapport',   label: 'Rapport dispo', color: '#34D399' },
  { key: 'urgentes',  label: 'Urgentes',      color: '#F87171' },
];

function filterPins(pins: MapPin[], filter: FilterKey): MapPin[] {
  switch (filter) {
    case 'en_cours':
      return pins.filter((p) =>
        ['confirmee', 'realisee', 'attente'].includes(p.statut) && p.priorite !== 'urgente'
      );
    case 'nouvelles':
      return pins.filter((p) => p.statut === 'nouvelle');
    case 'rapport':
      return pins.filter((p) => p.statut === 'rapport');
    case 'urgentes':
      return pins.filter((p) => p.priorite === 'urgente');
    default:
      return pins;
  }
}

export function SyndicMapWrapper({ pins }: { pins: MapPin[] }) {
  const [activeFilter, setActiveFilter] = useState<FilterKey>('toutes');
  const filtered = filterPins(pins, activeFilter);

  return (
    <div>
      {/* Chips filtres */}
      <div className="flex flex-wrap gap-2 mb-3">
        {FILTERS.map((f) => {
          const count = f.key === 'toutes' ? pins.length : filterPins(pins, f.key).length;
          if (f.key !== 'toutes' && count === 0) return null;
          const isActive = activeFilter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setActiveFilter(f.key)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold transition-all"
              style={{
                background: isActive ? f.color : 'rgba(255,255,255,0.06)',
                color: isActive ? '#fff' : '#94A3B8',
                border: `1.5px solid ${isActive ? f.color : 'rgba(255,255,255,0.12)'}`,
              }}
            >
              <span
                className="w-2 h-2 rounded-full inline-block"
                style={{ background: isActive ? '#fff' : f.color }}
              />
              {f.label}
              <span
                className="ml-0.5 text-[11px] font-bold opacity-80"
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Carte ou message vide */}
      {filtered.length > 0 ? (
        <div className="premium-card overflow-hidden p-0">
          <SyndicMap pins={filtered} />
        </div>
      ) : (
        <div className="premium-card p-6 text-center">
          <p className="text-[13px] text-ink-muted italic">
            Aucune intervention dans cette catégorie.
          </p>
        </div>
      )}
    </div>
  );
}
