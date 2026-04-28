'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { CreneauDisponible, Utilisateur } from '@/lib/types/database';
import { CreateInterventionModal } from './CreateInterventionModal';
import { ReservedSlotModal } from './ReservedSlotModal';
import { BlockedSlotModal } from './BlockedSlotModal';

const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];
const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const TECH_COLORS = [
  { bg: '#1B3A6B', soft: '#D6E4F7' },  // navy
  { bg: '#A17244', soft: '#F0DCC4' },  // ambre
  { bg: '#1F6B45', soft: '#D4EDE2' },  // ok
  { bg: '#C4622D', soft: '#F7EDE5' },  // terra
];

type Creneau = Pick<CreneauDisponible, 'id' | 'date' | 'heure_debut' | 'heure_fin' | 'statut' | 'technicien_id' | 'intervention_id'>;

export function PlanningCalendar({
  year,
  month,
  techs,
  creneaux,
  prevHref,
  nextHref,
}: {
  year: number;
  month: number;
  techs: Utilisateur[];
  creneaux: Creneau[];
  prevHref: string;
  nextHref: string;
}) {
  const router = useRouter();
  const [techFilter, setTechFilter] = useState<string>('all');
  const [openModal, setOpenModal] = useState<{ kind: 'free' | 'reserved' | 'blocked'; slot: Creneau } | null>(null);

  function refresh() { router.refresh(); }

  const techColorMap = useMemo(() => {
    const m = new Map<string, typeof TECH_COLORS[number]>();
    techs.forEach((t, i) => m.set(t.id, TECH_COLORS[i % TECH_COLORS.length]));
    return m;
  }, [techs]);

  const filtered = useMemo(() => {
    if (techFilter === 'all') return creneaux;
    return creneaux.filter((c) => c.technicien_id === techFilter);
  }, [creneaux, techFilter]);

  const counts = useMemo(() => {
    let libre = 0, reserve = 0, bloque = 0;
    for (const c of filtered) {
      if (c.statut === 'libre') libre++;
      else if (c.statut === 'reserve') reserve++;
      else bloque++;
    }
    return { libre, reserve, bloque };
  }, [filtered]);

  // Group by date
  const byDate = useMemo(() => {
    const m = new Map<string, Creneau[]>();
    for (const c of filtered) {
      if (!m.has(c.date)) m.set(c.date, []);
      m.get(c.date)!.push(c);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => a.heure_debut.localeCompare(b.heure_debut));
    }
    return m;
  }, [filtered]);

  // Calendar grid
  const cells = useMemo(() => buildGrid(year, month, byDate), [year, month, byDate]);
  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold text-ink-muted uppercase tracking-widest mr-2">
            Filtre tech
          </span>
          <button
            type="button"
            onClick={() => setTechFilter('all')}
            className={
              'px-3 py-1.5 rounded-md text-[12px] font-semibold border ' +
              (techFilter === 'all'
                ? 'bg-navy text-white border-navy'
                : 'bg-white text-ink-mid border-sand-border hover:border-navy-mid')
            }
          >
            Tous
          </button>
          {techs.map((t) => {
            const c = techColorMap.get(t.id)!;
            const active = techFilter === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTechFilter(t.id)}
                className={
                  'px-3 py-1.5 rounded-md text-[12px] font-semibold border flex items-center gap-1.5 ' +
                  (active ? 'text-white border-transparent' : 'bg-white text-ink-mid border-sand-border hover:border-navy-mid')
                }
                style={active ? { background: c.bg } : undefined}
              >
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: c.bg }} />
                {t.prenom} {t.nom}
              </button>
            );
          })}
        </div>

        <div className="flex gap-2">
          <Link
            href={prevHref}
            className="bg-sand-mid w-8 h-8 rounded-md text-ink-mid flex items-center justify-center hover:bg-sand-border"
          >‹</Link>
          <Link
            href={nextHref}
            className="bg-sand-mid w-8 h-8 rounded-md text-ink-mid flex items-center justify-center hover:bg-sand-border"
          >›</Link>
        </div>
      </div>

      <div className="text-[11px] text-ink-muted mb-3 capitalize">
        {MONTHS[month]} {year} · {counts.libre} libre · {counts.reserve} réservé · {counts.bloque} bloqué
      </div>

      {/* Légende statuts */}
      <div className="flex flex-wrap gap-3 mb-3">
        <Legend swatch="bg-ok-light border-ok-mid" label="Libre" />
        <Legend swatch="bg-navy-light border-navy-mid" label="Réservé" />
        <Legend swatch="bg-sand-mid border-sand-border" label="Bloqué" />
      </div>

      {/* Modaux */}
      {openModal?.kind === 'free' && (
        <CreateInterventionModal
          slot={{
            id: openModal.slot.id,
            date: openModal.slot.date,
            heure_debut: openModal.slot.heure_debut,
            heure_fin: openModal.slot.heure_fin,
            technicien_id: openModal.slot.technicien_id,
          }}
          techs={techs}
          onClose={() => setOpenModal(null)}
          onCreated={refresh}
        />
      )}
      {openModal?.kind === 'reserved' && openModal.slot.intervention_id && (
        <ReservedSlotModal
          slotId={openModal.slot.id}
          interventionId={openModal.slot.intervention_id}
          slotInfo={{
            date: openModal.slot.date,
            heure_debut: openModal.slot.heure_debut,
            heure_fin: openModal.slot.heure_fin,
          }}
          techs={techs}
          onClose={() => setOpenModal(null)}
          onChanged={refresh}
        />
      )}
      {openModal?.kind === 'blocked' && (
        <BlockedSlotModal
          slotId={openModal.slot.id}
          slotInfo={{
            date: openModal.slot.date,
            heure_debut: openModal.slot.heure_debut,
            heure_fin: openModal.slot.heure_fin,
          }}
          initialMotif={null}
          onClose={() => setOpenModal(null)}
          onChanged={refresh}
        />
      )}

      {/* Calendar */}
      <div className="bg-cream rounded-xl border border-sand-border overflow-hidden dark:bg-[#1C1A16] dark:border-[#2C2A24]">
        <div className="grid grid-cols-7 gap-px bg-sand-border">
          {DAYS.map((d) => (
            <div key={d} className="bg-sand text-center py-2 text-[10px] font-bold text-ink-muted uppercase">
              {d}
            </div>
          ))}
          {cells.map((c) => (
            <div
              key={c.key}
              className={
                'p-2 min-h-[110px] ' +
                (c.inMonth
                  ? c.iso === todayStr ? 'bg-navy-pale' : 'bg-cream'
                  : 'bg-[#FAFAF8] opacity-50')
              }
            >
              {c.inMonth && (
                <div className={
                  'text-[11px] font-semibold mb-1.5 ' +
                  (c.iso === todayStr ? 'text-navy font-extrabold' : 'text-ink-mid')
                }>
                  {c.day}
                </div>
              )}
              <div className="space-y-1">
                {c.items.map((cr) => {
                  const techColor = cr.technicien_id ? techColorMap.get(cr.technicien_id) : null;
                  const time = cr.heure_debut.replace(':', 'h');
                  if (cr.statut === 'libre') {
                    return (
                      <button
                        key={cr.id}
                        type="button"
                        onClick={() => setOpenModal({ kind: 'free', slot: cr })}
                        className="w-full text-left text-[10px] font-semibold rounded px-1.5 py-0.5 truncate hover:brightness-95 cursor-pointer"
                        title="Cliquer pour planifier une intervention"
                        style={
                          techColor
                            ? { background: '#1F6B45', color: '#FFFFFF', borderLeft: `3px solid ${techColor.bg}` }
                            : { background: '#1F6B45', color: '#FFFFFF' }
                        }
                      >
                        {time}
                      </button>
                    );
                  }
                  if (cr.statut === 'reserve') {
                    return (
                      <button
                        key={cr.id}
                        type="button"
                        onClick={() => setOpenModal({ kind: 'reserved', slot: cr })}
                        className="w-full text-left block text-[10px] font-semibold rounded px-1.5 py-0.5 truncate hover:brightness-95 cursor-pointer"
                        title="Cliquer pour modifier l'intervention"
                        style={
                          techColor
                            ? { background: techColor.soft, color: techColor.bg, borderLeft: `3px solid ${techColor.bg}` }
                            : { background: '#D6E4F7', color: '#1B3A6B' }
                        }
                      >
                        {time} ✓
                      </button>
                    );
                  }
                  return (
                    <button
                      key={cr.id}
                      type="button"
                      onClick={() => setOpenModal({ kind: 'blocked', slot: cr })}
                      className="w-full text-left text-[10px] font-semibold rounded px-1.5 py-0.5 truncate bg-sand-mid text-ink-muted hover:bg-sand-border cursor-pointer dark:bg-[#3D3A32] dark:text-[#C8C2B8]"
                      title="Cliquer pour modifier le motif ou débloquer"
                    >
                      {time}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-ink-mid">
      <span className={`w-3 h-3 rounded-sm ${swatch} border`} />
      {label}
    </div>
  );
}

type Cell = {
  key: string;
  day: number;
  inMonth: boolean;
  iso: string;
  items: Creneau[];
};

function buildGrid(year: number, month: number, byDate: Map<string, Creneau[]>): Cell[] {
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);
  const startDow = (firstOfMonth.getDay() + 6) % 7;

  const cells: Cell[] = [];
  for (let i = 0; i < startDow; i++) {
    const d = new Date(year, month, -(startDow - i - 1));
    cells.push({ key: `pad-${i}`, day: d.getDate(), inMonth: false, iso: '', items: [] });
  }
  for (let d = 1; d <= lastOfMonth.getDate(); d++) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ key: iso, day: d, inMonth: true, iso, items: byDate.get(iso) ?? [] });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ key: `tail-${cells.length}`, day: 0, inMonth: false, iso: '', items: [] });
  }
  return cells;
}
