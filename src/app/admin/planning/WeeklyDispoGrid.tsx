'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Utilisateur } from '@/lib/types/database';

const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] as const;
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17] as const;
type Hour = typeof HOURS[number];
type DayIdx = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const ALLOWED_WEEKS = [1, 2, 4, 8] as const;
type WeekCount = typeof ALLOWED_WEEKS[number];

// Clé unique d'une cellule dans la Set : "day-hour"
function cellKey(day: number, hour: number): string {
  return `${day}-${hour}`;
}

export function WeeklyDispoGrid({ techs }: { techs: Utilisateur[] }) {
  const router = useRouter();
  const [techId, setTechId] = useState<string>(techs[0]?.id ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [weeks, setWeeks] = useState<WeekCount>(1);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  // Drag select
  const [dragging, setDragging] = useState<{ mode: 'add' | 'remove' } | null>(null);

  function toggleCell(day: number, hour: number, mode?: 'add' | 'remove') {
    setSelected((s) => {
      const k = cellKey(day, hour);
      const next = new Set(s);
      if (mode === 'add') next.add(k);
      else if (mode === 'remove') next.delete(k);
      else if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  const onMouseDown = useCallback((day: number, hour: number) => {
    const k = cellKey(day, hour);
    const isOn = selected.has(k);
    const mode: 'add' | 'remove' = isOn ? 'remove' : 'add';
    setDragging({ mode });
    toggleCell(day, hour, mode);
  }, [selected]);

  const onMouseEnter = useCallback((day: number, hour: number) => {
    if (!dragging) return;
    toggleCell(day, hour, dragging.mode);
  }, [dragging]);

  function endDrag() { setDragging(null); }

  function presetSemaineStandard() {
    const next = new Set<string>();
    for (let day = 0; day < 5; day++) {           // Lun-Ven
      for (let h = 8; h < 17; h++) {              // 8h-17h (donc 8 → 16h dernier)
        next.add(cellKey(day, h));
      }
    }
    setSelected(next);
  }

  function selectAllWeekdaysFull() {
    const next = new Set<string>();
    for (let day = 0; day < 5; day++) {
      for (const h of HOURS) {
        next.add(cellKey(day, h));
      }
    }
    setSelected(next);
  }

  function clearAll() { setSelected(new Set()); }

  async function save() {
    if (!techId) {
      setMsg({ kind: 'err', msg: 'Choisis un technicien.' });
      return;
    }
    if (selected.size === 0) {
      setMsg({ kind: 'err', msg: 'Aucune case sélectionnée.' });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const slots: { day: number; hour: number }[] = [];
      for (const k of selected) {
        const [d, h] = k.split('-').map(Number);
        slots.push({ day: d, hour: h });
      }
      const r = await fetch('/api/admin/planning/dispos/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ technicien_id: techId, slots, weeks }),
      });
      const data = await r.json();
      if (!data.ok) {
        setMsg({ kind: 'err', msg: data.error ?? 'Échec sauvegarde.' });
        return;
      }
      const parts: string[] = [];
      parts.push(`${data.created} créé(s)`);
      if (data.skipped_existing) parts.push(`${data.skipped_existing} déjà existant(s)`);
      if (data.skipped) parts.push(`${data.skipped} dans le passé`);
      setMsg({ kind: 'ok', msg: `✓ ${parts.join(' · ')}` });
      router.refresh();
    } catch (e) {
      setMsg({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
    } finally {
      setSaving(false);
    }
  }

  const cellCount = selected.size;
  const totalForWeeks = useMemo(() => cellCount * weeks, [cellCount, weeks]);

  return (
    <div onMouseUp={endDrag} onMouseLeave={endDrag} className="select-none">
      {/* Onglets techniciens */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <span className="text-[10px] font-bold uppercase tracking-widest text-ink-muted mr-2 dark:text-[#C8C2B8]">
          Technicien
        </span>
        {techs.map((t, i) => {
          const active = techId === t.id;
          const label = `T.${i + 1} ${t.prenom ?? t.email}`;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTechId(t.id)}
              className={
                'px-3 py-1.5 rounded-md text-[12px] font-bold border transition-colors ' +
                (active
                  ? 'bg-navy text-white border-navy'
                  : 'bg-white text-ink-mid border-sand-border hover:border-navy-mid dark:bg-[#221E1A] dark:text-[#C8C2B8] dark:border-[#3D3A32]')
              }
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Boutons rapides */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        <button
          type="button"
          onClick={presetSemaineStandard}
          className="text-[11px] bg-sand-mid text-ink-mid border border-sand-border px-2.5 py-1 rounded font-bold dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8] dark:border-[#3D3A32]"
        >
          Lun–Ven 8h–17h
        </button>
        <button
          type="button"
          onClick={selectAllWeekdaysFull}
          className="text-[11px] bg-sand-mid text-ink-mid border border-sand-border px-2.5 py-1 rounded font-bold dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8] dark:border-[#3D3A32]"
        >
          Lun–Ven toute la journée
        </button>
        <button
          type="button"
          onClick={clearAll}
          className="text-[11px] bg-terra-light text-terra border border-terra-mid px-2.5 py-1 rounded font-bold dark:bg-[#5A2E18] dark:text-[#FFB897] dark:border-[#7A3F22]"
        >
          ✕ Effacer tout
        </button>
      </div>

      {/* Grille heures × jours */}
      <div className="bg-cream border border-sand-border rounded-xl overflow-hidden dark:bg-[#1C1A16] dark:border-[#2C2A24]">
        <div
          className="grid"
          style={{ gridTemplateColumns: '60px repeat(7, 1fr)' }}
        >
          {/* Header — coin vide + jours */}
          <div className="bg-sand border-b border-r border-sand-border dark:bg-[#141210] dark:border-[#2C2A24]" />
          {DAYS.map((d) => (
            <div
              key={d}
              className="bg-sand text-center py-2 border-b border-r border-sand-border last:border-r-0 text-[11px] font-bold uppercase tracking-wider text-ink-muted dark:bg-[#141210] dark:border-[#2C2A24] dark:text-[#C8C2B8]"
            >
              {d}
            </div>
          ))}

          {/* Lignes : heure + 7 cases */}
          {HOURS.map((h) => (
            <Row
              key={h}
              hour={h}
              selected={selected}
              onMouseDownCell={onMouseDown}
              onMouseEnterCell={onMouseEnter}
            />
          ))}
        </div>
      </div>

      {/* Footer actions */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="text-[11px] text-ink-mid dark:text-[#C8C2B8]">
          {cellCount} créneau{cellCount !== 1 ? 'x' : ''} sélectionné{cellCount !== 1 ? 's' : ''}
          {weeks > 1 && <> · <strong>{totalForWeeks}</strong> sur {weeks} semaines</>}
        </span>
        <div className="flex items-center gap-2 ml-auto">
          <label className="text-[11px] text-ink-mid font-semibold dark:text-[#C8C2B8]">
            Appliquer sur
          </label>
          <select
            value={weeks}
            onChange={(e) => setWeeks(parseInt(e.target.value, 10) as WeekCount)}
            className="px-2 py-1 border border-sand-border rounded text-[12px] bg-white outline-none focus:border-navy-mid dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
          >
            {ALLOWED_WEEKS.map((n) => (
              <option key={n} value={n}>{n} semaine{n > 1 ? 's' : ''}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={save}
            disabled={saving || !techId || cellCount === 0}
            className="bg-navy text-white px-3.5 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Enregistrement…' : '💾 Enregistrer les dispos'}
          </button>
        </div>
      </div>

      {msg && (
        <div className={
          'mt-2 px-3 py-2 text-[12px] rounded-md border font-semibold ' +
          (msg.kind === 'ok'
            ? 'bg-ok-light border-ok-mid text-ok dark:bg-[#14281E] dark:border-[#2A4F3A] dark:text-[#7AC9A0]'
            : 'bg-terra-light border-terra-mid text-terra')
        }>
          {msg.msg}
        </div>
      )}

      <p className="text-[10px] text-ink-muted italic mt-2 dark:text-[#C8C2B8]">
        Astuce : maintiens le clic et glisse pour sélectionner plusieurs cases en un seul geste.
        Les créneaux qui existent déjà ou tombent dans le passé sont automatiquement ignorés.
      </p>
    </div>
  );
}

function Row({
  hour, selected, onMouseDownCell, onMouseEnterCell,
}: {
  hour: Hour;
  selected: Set<string>;
  onMouseDownCell: (day: number, hour: number) => void;
  onMouseEnterCell: (day: number, hour: number) => void;
}) {
  return (
    <>
      <div className="bg-sand border-b border-r border-sand-border text-[10px] font-mono font-bold text-ink-muted text-center py-2 dark:bg-[#141210] dark:border-[#2C2A24] dark:text-[#C8C2B8]">
        {String(hour).padStart(2, '0')}h
      </div>
      {[0, 1, 2, 3, 4, 5, 6].map((day) => {
        const k = cellKey(day, hour);
        const on = selected.has(k);
        return (
          <button
            key={k}
            type="button"
            onMouseDown={(e) => { e.preventDefault(); onMouseDownCell(day, hour); }}
            onMouseEnter={() => onMouseEnterCell(day, hour)}
            className={
              'h-10 border-b border-r border-sand-border last:border-r-0 transition-colors cursor-pointer dark:border-[#2C2A24] ' +
              (on
                ? 'bg-navy hover:brightness-110'
                : 'bg-white hover:bg-sand-hover dark:bg-[#221E1A] dark:hover:bg-[#2A2520]')
            }
          />
        );
      })}
    </>
  );
}
