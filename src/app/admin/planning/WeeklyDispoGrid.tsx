'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Utilisateur } from '@/lib/types/database';
import { FOXO_SLOTS, FOXO_DAYS, FOXO_DAYS_SHORT, type FoxoDay } from '@/lib/foxo-slots';

const ALLOWED_WEEKS = [1, 2, 4, 8] as const;
type WeekCount = typeof ALLOWED_WEEKS[number];

// Cellule = (dayIdx 0..6, slotIdx 0..4)
function cellKey(day: number, slotIdx: number): string {
  return `${day}-${slotIdx}`;
}

function startOfMondayThisWeek(): Date {
  const now = new Date();
  const dow = now.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  const m = new Date(now);
  m.setDate(now.getDate() + offset);
  m.setHours(0, 0, 0, 0);
  return m;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function WeeklyDispoGrid({ techs }: { techs: Utilisateur[] }) {
  const router = useRouter();
  const [techId, setTechId] = useState<string>(techs[0]?.id ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [weeks, setWeeks] = useState<WeekCount>(1);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  // Lundi de la semaine d'application — point de départ pour les N semaines.
  // Le date picker accepte n'importe quel jour ; on snap au lundi le plus
  // proche (passé) côté handler.
  const [weekStart, setWeekStart] = useState<Date>(() => startOfMondayThisWeek());

  function snapToMonday(d: Date): Date {
    const dow = d.getDay();
    const offset = dow === 0 ? -6 : 1 - dow;
    const m = new Date(d);
    m.setDate(d.getDate() + offset);
    m.setHours(0, 0, 0, 0);
    return m;
  }

  function handleStartDateChange(input: string) {
    if (!input) return;
    const [y, m, d] = input.split('-').map(Number);
    if (!y || !m || !d) return;
    const date = new Date(y, m - 1, d);
    if (Number.isNaN(date.getTime())) return;
    setWeekStart(snapToMonday(date));
  }

  // Date de fin = dimanche de la (N-1)e semaine après weekStart
  const rangeEnd = useMemo(() => {
    const end = new Date(weekStart);
    end.setDate(weekStart.getDate() + weeks * 7 - 1);
    return end;
  }, [weekStart, weeks]);

  function fmtLong(d: Date): string {
    return d.toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  // Drag select
  const [dragging, setDragging] = useState<{ mode: 'add' | 'remove' } | null>(null);

  function toggleCell(day: number, slotIdx: number, mode?: 'add' | 'remove') {
    setSelected((s) => {
      const k = cellKey(day, slotIdx);
      const next = new Set(s);
      if (mode === 'add') next.add(k);
      else if (mode === 'remove') next.delete(k);
      else if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  const onMouseDown = useCallback((day: number, slotIdx: number) => {
    const k = cellKey(day, slotIdx);
    const isOn = selected.has(k);
    const mode: 'add' | 'remove' = isOn ? 'remove' : 'add';
    setDragging({ mode });
    toggleCell(day, slotIdx, mode);
  }, [selected]);

  const onMouseEnter = useCallback((day: number, slotIdx: number) => {
    if (!dragging) return;
    toggleCell(day, slotIdx, dragging.mode);
  }, [dragging]);

  function endDrag() { setDragging(null); }

  // Presets
  function presetSemaineStandard() {
    // Lun–Ven × Matin 1 / Matin 2 / Après-midi (slotIdx 0, 1, 2)
    const next = new Set<string>();
    for (let day = 0; day < 5; day++) {
      for (const slotIdx of [0, 1, 2]) {
        next.add(cellKey(day, slotIdx));
      }
    }
    setSelected(next);
  }

  function presetAvecSoirees() {
    // Lun–Ven × tous les créneaux (5)
    const next = new Set<string>();
    for (let day = 0; day < 5; day++) {
      for (let slotIdx = 0; slotIdx < FOXO_SLOTS.length; slotIdx++) {
        next.add(cellKey(day, slotIdx));
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
      const slotsPayload: { day: FoxoDay; heure_debut: string; heure_fin: string }[] = [];
      for (const k of selected) {
        const [d, s] = k.split('-').map(Number);
        const slot = FOXO_SLOTS[s];
        if (!slot) continue;
        slotsPayload.push({
          day: FOXO_DAYS[d],
          heure_debut: slot.heure_debut,
          heure_fin: slot.heure_fin,
        });
      }
      const r = await fetch('/api/admin/planning/dispos/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          technicien_id: techId,
          slots: slotsPayload,
          weeks,
          start_date: isoDate(weekStart),
        }),
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
      // Toast inclut le nom du technicien (visible dans la barre statut)
      const tech = techs.find((t) => t.id === techId);
      const techLabel = tech ? [tech.prenom, tech.nom].filter(Boolean).join(' ') || tech.email || 'tech' : 'technicien';
      setMsg({ kind: 'ok', msg: `✅ ${data.created} créneau${data.created > 1 ? 'x' : ''} créé${data.created > 1 ? 's' : ''} pour ${techLabel} · ${parts.slice(1).join(' · ')}`.trim() });
      setSelected(new Set());
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
          Semaine standard
        </button>
        <button
          type="button"
          onClick={presetAvecSoirees}
          className="text-[11px] bg-sand-mid text-ink-mid border border-sand-border px-2.5 py-1 rounded font-bold dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8] dark:border-[#3D3A32]"
        >
          Avec soirées
        </button>
        <button
          type="button"
          onClick={clearAll}
          className="text-[11px] bg-terra-light text-terra border border-terra-mid px-2.5 py-1 rounded font-bold dark:bg-[#5A2E18] dark:text-[#FFB897] dark:border-[#7A3F22]"
        >
          ✕ Tout effacer
        </button>
      </div>

      {/* Sélecteur de semaine de départ + résumé */}
      <div className="bg-cream border border-sand-border rounded-xl px-3 py-2.5 mb-3 flex flex-wrap items-center gap-3 dark:bg-[#1C1A16] dark:border-[#2C2A24]">
        <label className="text-[11px] font-bold text-ink-muted dark:text-[#C8C2B8]">
          Semaine de départ
        </label>
        <input
          type="date"
          value={isoDate(weekStart)}
          onChange={(e) => handleStartDateChange(e.target.value)}
          className="px-2 py-1 border border-sand-border rounded text-[12px] bg-white outline-none focus:border-navy-mid font-mono dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
        />
        <span className="text-[11px] text-ink dark:text-[#F0ECE4]">
          → <strong>{fmtLong(weekStart)}</strong>
        </span>
        {cellCount > 0 && (
          <span className="text-[11px] text-ink-muted ml-auto dark:text-[#C8C2B8]">
            Créera des créneaux du <strong className="text-ink dark:text-[#F0ECE4]">{fmtLong(weekStart)}</strong> au{' '}
            <strong className="text-ink dark:text-[#F0ECE4]">{fmtLong(rangeEnd)}</strong>
          </span>
        )}
      </div>

      {/* Grille jours × créneaux */}
      <div className="bg-cream border border-sand-border rounded-xl overflow-hidden dark:bg-[#1C1A16] dark:border-[#2C2A24]">
        <div
          className="grid"
          style={{ gridTemplateColumns: '90px repeat(7, 1fr)' }}
        >
          {/* Header — coin vide + jours */}
          <div className="bg-sand border-b border-r border-sand-border dark:bg-[#141210] dark:border-[#2C2A24]" />
          {FOXO_DAYS_SHORT.map((d) => (
            <div
              key={d}
              className="bg-sand text-center py-2 border-b border-r border-sand-border last:border-r-0 text-[11px] font-bold uppercase tracking-wider text-ink-muted dark:bg-[#141210] dark:border-[#2C2A24] dark:text-[#C8C2B8]"
            >
              {d}
            </div>
          ))}

          {/* Lignes : créneau + 7 cases */}
          {FOXO_SLOTS.map((slot, slotIdx) => (
            <Row
              key={slotIdx}
              slot={slot}
              slotIdx={slotIdx}
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
        Astuce : maintiens le clic et glisse pour sélectionner plusieurs cases.
        Les créneaux dans le passé ou déjà existants sont automatiquement ignorés.
      </p>
    </div>
  );
}

function Row({
  slot, slotIdx, selected, onMouseDownCell, onMouseEnterCell,
}: {
  slot: typeof FOXO_SLOTS[number];
  slotIdx: number;
  selected: Set<string>;
  onMouseDownCell: (day: number, slotIdx: number) => void;
  onMouseEnterCell: (day: number, slotIdx: number) => void;
}) {
  return (
    <>
      <div className="bg-sand border-b border-r border-sand-border text-center py-2 dark:bg-[#141210] dark:border-[#2C2A24]">
        <div className="text-[11px] font-mono font-extrabold text-ink dark:text-[#F0ECE4]">
          {slot.heure_debut}
        </div>
        <div className="text-[9px] font-mono text-ink-muted dark:text-[#C8C2B8]">
          →{slot.heure_fin}
        </div>
      </div>
      {[0, 1, 2, 3, 4, 5, 6].map((day) => {
        const k = cellKey(day, slotIdx);
        const on = selected.has(k);
        return (
          <button
            key={k}
            type="button"
            onMouseDown={(e) => { e.preventDefault(); onMouseDownCell(day, slotIdx); }}
            onMouseEnter={() => onMouseEnterCell(day, slotIdx)}
            className={
              'h-12 border-b border-r border-sand-border last:border-r-0 transition-colors cursor-pointer dark:border-[#2C2A24] ' +
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
