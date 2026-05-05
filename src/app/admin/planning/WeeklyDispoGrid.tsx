'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Utilisateur } from '@/lib/types/database';
import { FOXO_SLOTS, FOXO_DAYS, FOXO_DAYS_SHORT, type FoxoDay } from '@/lib/foxo-slots';

// État interne d'une cellule : {existing: id | null, statut: ...}
// existing=null → cellule vide en DB. existing=string → créneau en DB
// avec cet id. Le set 'selected' contient les cells cochées (à exister
// après save). On compare selected vs existingByKey pour déterminer
// les inserts (selected mais pas existing) et les deletes (existing
// mais plus dans selected).
type SlotStatut = 'libre' | 'reserve' | 'bloque';
interface ExistingSlot { id: string; statut: SlotStatut; google_event_id: string | null }

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
  const [existingByKey, setExistingByKey] = useState<Map<string, ExistingSlot>>(new Map());
  const [loadingExisting, setLoadingExisting] = useState(false);
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

  // Charge les créneaux existants en DB pour le tech + la semaine
  // affichée (weekStart → +6 jours). Pré-coche les cases correspondantes
  // et alimente existingByKey pour le calcul de diff au save.
  // Recharge à chaque changement de tech ou de semaine. Un refreshTick
  // permet de re-trigger après une sauvegarde réussie.
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    if (!techId) {
      setExistingByKey(new Map());
      setSelected(new Set());
      return;
    }
    const ac = new AbortController();
    setLoadingExisting(true);
    const endDate = new Date(weekStart);
    endDate.setDate(weekStart.getDate() + 6);
    const url = `/api/admin/planning/dispos?technicien_id=${encodeURIComponent(techId)}&start_date=${isoDate(weekStart)}&end_date=${isoDate(endDate)}`;
    fetch(url, { signal: ac.signal, cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) return;
        type LoadedSlot = { id: string; date: string; heure_debut: string; heure_fin: string; statut: SlotStatut; google_event_id: string | null };
        const map = new Map<string, ExistingSlot>();
        const sel = new Set<string>();
        for (const s of (data.slots ?? []) as LoadedSlot[]) {
          // Calcule dayIdx (0=lun) depuis la date du slot relative au lundi
          const slotDate = new Date(s.date + 'T00:00:00');
          const dow = slotDate.getDay();
          const dayIdx = dow === 0 ? 6 : dow - 1;
          const hd = s.heure_debut.slice(0, 5);
          const slotIdx = FOXO_SLOTS.findIndex((fs) => fs.heure_debut === hd);
          if (slotIdx < 0) continue; // slot non-FoxO (legacy 1h, etc.)
          const k = cellKey(dayIdx, slotIdx);
          map.set(k, { id: s.id, statut: s.statut, google_event_id: s.google_event_id });
          sel.add(k);
        }
        setExistingByKey(map);
        setSelected(sel);
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === 'AbortError') return;
        console.warn('[WeeklyDispoGrid] load existing failed:', e);
      })
      .finally(() => setLoadingExisting(false));
    return () => ac.abort();
  }, [techId, weekStart, refreshTick]);

  async function save() {
    if (!techId) {
      setMsg({ kind: 'err', msg: 'Choisis un technicien.' });
      return;
    }
    // Diff : ajouts (selected mais pas existing) + suppressions
    // (existing libre mais plus dans selected). Les non-libre (réservés,
    // bloqués) ne peuvent pas être supprimés depuis cette grille.
    const toAddKeys: string[] = [];
    const toDeleteIds: string[] = [];
    const skippedReserved: string[] = [];
    for (const k of selected) {
      if (!existingByKey.has(k)) toAddKeys.push(k);
    }
    for (const [k, slot] of existingByKey.entries()) {
      if (!selected.has(k)) {
        if (slot.statut === 'libre') toDeleteIds.push(slot.id);
        else skippedReserved.push(k);
      }
    }
    if (toAddKeys.length === 0 && toDeleteIds.length === 0) {
      setMsg({ kind: 'err', msg: 'Aucun changement à enregistrer.' });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      let createdCount = 0;
      let calendarSynced = 0;
      let calendarFailed = 0;
      let deletedCount = 0;
      let calendarDeleted = 0;

      // Étape 1 : POST insertions (avec récurrence sur N semaines)
      if (toAddKeys.length > 0) {
        const slotsPayload: { day: FoxoDay; heure_debut: string; heure_fin: string }[] = [];
        for (const k of toAddKeys) {
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
        createdCount = data.created ?? 0;
        calendarSynced = data.calendar_synced ?? 0;
        calendarFailed = data.calendar_failed ?? 0;
      }

      // Étape 2 : DELETE des cases décochées (uniquement la semaine en cours)
      if (toDeleteIds.length > 0) {
        const r = await fetch('/api/admin/planning/dispos/bulk', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slot_ids: toDeleteIds }),
        });
        const data = await r.json();
        if (!data.ok) {
          setMsg({ kind: 'err', msg: data.error ?? 'Échec suppression.' });
          return;
        }
        deletedCount = data.deleted ?? 0;
        calendarDeleted = data.calendar_deleted ?? 0;
      }

      // Toast récapitulatif
      const tech = techs.find((t) => t.id === techId);
      const techLabel = tech ? [tech.prenom, tech.nom].filter(Boolean).join(' ') || tech.email || 'tech' : 'technicien';
      const parts: string[] = [];
      if (createdCount > 0) parts.push(`+${createdCount} créé(s)`);
      if (deletedCount > 0) parts.push(`-${deletedCount} supprimé(s)`);
      if (calendarSynced > 0) parts.push(`📅 ${calendarSynced} sync`);
      if (calendarDeleted > 0) parts.push(`🗑 ${calendarDeleted} retiré(s) du Calendar`);
      if (calendarFailed > 0) parts.push(`⚠️ ${calendarFailed} sync calendar échouée(s)`);
      if (skippedReserved.length > 0) parts.push(`${skippedReserved.length} non supprimé(s) (réservés)`);
      setMsg({ kind: 'ok', msg: `✅ ${techLabel} · ${parts.join(' · ')}` });
      setRefreshTick((t) => t + 1);
      router.refresh();
    } catch (e) {
      setMsg({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
    } finally {
      setSaving(false);
    }
  }

  const cellCount = selected.size;
  const totalForWeeks = useMemo(() => cellCount * weeks, [cellCount, weeks]);
  const diffCount = useMemo(() => {
    let adds = 0, removes = 0;
    for (const k of selected) if (!existingByKey.has(k)) adds++;
    for (const [k, slot] of existingByKey.entries()) {
      if (!selected.has(k) && slot.statut === 'libre') removes++;
    }
    return { adds, removes };
  }, [selected, existingByKey]);

  return (
    <div onMouseUp={endDrag} onMouseLeave={endDrag} className="select-none">
      {/* Onglets techniciens */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <span className="text-[10px] font-bold uppercase tracking-widest text-ink-muted mr-2">
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
                  : 'bg-white text-ink-mid border-sand-border hover:border-navy-mid')
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
          className="text-[11px] bg-sand-mid text-ink-mid border border-sand-border px-2.5 py-1 rounded font-bold dark:bg-[rgba(255,255,255,.06)]"
        >
          Semaine standard
        </button>
        <button
          type="button"
          onClick={presetAvecSoirees}
          className="text-[11px] bg-sand-mid text-ink-mid border border-sand-border px-2.5 py-1 rounded font-bold dark:bg-[rgba(255,255,255,.06)]"
        >
          Avec soirées
        </button>
        <button
          type="button"
          onClick={clearAll}
          className="text-[11px] bg-terra-light text-terra border border-terra-mid px-2.5 py-1 rounded font-bold"
        >
          ✕ Tout effacer
        </button>
      </div>

      {/* Sélecteur de semaine de départ + résumé */}
      <div className="bg-cream border border-sand-border rounded-xl px-3 py-2.5 mb-3 flex flex-wrap items-center gap-3">
        <label className="text-[11px] font-bold text-ink-muted">
          Semaine de départ
        </label>
        <input
          type="date"
          value={isoDate(weekStart)}
          onChange={(e) => handleStartDateChange(e.target.value)}
          className="px-2 py-1 border border-sand-border rounded text-[12px] bg-white outline-none focus:border-navy-mid font-mono"
        />
        <span className="text-[11px] text-ink">
          → <strong>{fmtLong(weekStart)}</strong>
        </span>
        {cellCount > 0 && (
          <span className="text-[11px] text-ink-muted ml-auto">
            Créera des créneaux du <strong className="text-ink">{fmtLong(weekStart)}</strong> au{' '}
            <strong className="text-ink">{fmtLong(rangeEnd)}</strong>
          </span>
        )}
      </div>

      {/* Grille jours × créneaux */}
      <div className="bg-cream border border-sand-border rounded-xl overflow-hidden">
        <div
          className="grid"
          style={{ gridTemplateColumns: '90px repeat(7, 1fr)' }}
        >
          {/* Header — coin vide + jours */}
          <div className="bg-sand border-b border-r border-sand-border" />
          {FOXO_DAYS_SHORT.map((d) => (
            <div
              key={d}
              className="bg-sand text-center py-2 border-b border-r border-sand-border last:border-r-0 text-[11px] font-bold uppercase tracking-wider text-ink-muted"
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
              existingByKey={existingByKey}
              onMouseDownCell={onMouseDown}
              onMouseEnterCell={onMouseEnter}
            />
          ))}
        </div>
      </div>

      {/* Footer actions */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="text-[11px] text-ink-mid">
          {loadingExisting ? (
            <span className="italic">Chargement des créneaux existants…</span>
          ) : (
            <>
              {cellCount} coché{cellCount !== 1 ? 's' : ''}
              {weeks > 1 && diffCount.adds > 0 && <> · <strong>{diffCount.adds * weeks}</strong> à créer sur {weeks} semaines</>}
              {weeks === 1 && diffCount.adds > 0 && <> · <strong>+{diffCount.adds}</strong> à créer</>}
              {diffCount.removes > 0 && <> · <strong className="text-[#8A5A1A]">−{diffCount.removes}</strong> à supprimer</>}
            </>
          )}
        </span>
        <div className="flex items-center gap-2 ml-auto">
          <label className="text-[11px] text-ink-mid font-semibold">
            Appliquer sur
          </label>
          <select
            value={weeks}
            onChange={(e) => setWeeks(parseInt(e.target.value, 10) as WeekCount)}
            className="px-2 py-1 border border-sand-border rounded text-[12px] bg-white outline-none focus:border-navy-mid"
          >
            {ALLOWED_WEEKS.map((n) => (
              <option key={n} value={n}>{n} semaine{n > 1 ? 's' : ''}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={save}
            disabled={saving || !techId || (diffCount.adds === 0 && diffCount.removes === 0)}
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
            ? 'bg-ok-light border-ok-mid text-ok'
            : 'bg-terra-light border-terra-mid text-terra')
        }>
          {msg.msg}
        </div>
      )}

      <p className="text-[10px] text-ink-muted italic mt-2">
        Astuce : les cases déjà cochées en navy sont les créneaux enregistrés en DB.
        Décocher une case = suppression au prochain enregistrement (badge ambre ✕).
        Les créneaux 🔒 réservés ou 🚫 bloqués ne peuvent pas être supprimés ici.
      </p>
      <p className="text-[10px] text-ink-muted mt-1">
        <span className="text-[9px] uppercase font-bold tracking-wider">{totalForWeeks ? `${totalForWeeks} créneaux total après save` : ''}</span>
      </p>
    </div>
  );
}

function Row({
  slot, slotIdx, selected, existingByKey, onMouseDownCell, onMouseEnterCell,
}: {
  slot: typeof FOXO_SLOTS[number];
  slotIdx: number;
  selected: Set<string>;
  existingByKey: Map<string, ExistingSlot>;
  onMouseDownCell: (day: number, slotIdx: number) => void;
  onMouseEnterCell: (day: number, slotIdx: number) => void;
}) {
  return (
    <>
      <div className="bg-sand border-b border-r border-sand-border text-center py-2">
        <div className="text-[11px] font-mono font-extrabold text-ink">
          {slot.heure_debut}
        </div>
        <div className="text-[9px] font-mono text-ink-muted">
          →{slot.heure_fin}
        </div>
      </div>
      {[0, 1, 2, 3, 4, 5, 6].map((day) => {
        const k = cellKey(day, slotIdx);
        const on = selected.has(k);
        const existing = existingByKey.get(k);
        const locked = Boolean(existing && existing.statut !== 'libre');
        // Visual states :
        // - locked (réservé/bloqué) : navy strié, non-cliquable
        // - on + existing libre : navy plein (créneau enregistré)
        // - on + nouveau : navy clair avec bordure (sera créé)
        // - off + existing : ambré (sera supprimé après save)
        // - off + nouveau : blanc
        const willDelete = !on && existing && existing.statut === 'libre';
        const willCreate = on && !existing;
        let cellClass = 'h-12 border-b border-r border-sand-border last:border-r-0 transition-colors flex items-center justify-center text-[10px] font-bold ';
        if (locked) {
          cellClass += 'bg-navy/40 cursor-not-allowed text-white/70 ';
        } else if (on && existing) {
          cellClass += 'bg-navy hover:brightness-110 cursor-pointer text-white/90 ';
        } else if (willCreate) {
          cellClass += 'bg-navy-light/60 hover:brightness-110 cursor-pointer text-navy border-2 border-navy-mid ';
        } else if (willDelete) {
          cellClass += 'bg-amber-light hover:brightness-95 cursor-pointer text-[#8A5A1A] border-2 border-[#E8C896] ';
        } else {
          cellClass += 'bg-white hover:bg-sand-hover cursor-pointer ';
        }
        return (
          <button
            key={k}
            type="button"
            disabled={locked}
            onMouseDown={(e) => {
              if (locked) return;
              e.preventDefault();
              onMouseDownCell(day, slotIdx);
            }}
            onMouseEnter={() => { if (!locked) onMouseEnterCell(day, slotIdx); }}
            className={cellClass}
            title={
              locked
                ? (existing?.statut === 'reserve' ? 'Réservé — ne peut pas être supprimé d\'ici' : 'Bloqué')
                : willDelete
                  ? 'Sera supprimé au prochain enregistrement'
                  : willCreate
                    ? 'Sera créé au prochain enregistrement'
                    : on ? 'Enregistré' : 'Vide'
            }
          >
            {locked ? (existing?.statut === 'reserve' ? '🔒' : '🚫') : willDelete ? '✕' : ''}
          </button>
        );
      })}
    </>
  );
}
