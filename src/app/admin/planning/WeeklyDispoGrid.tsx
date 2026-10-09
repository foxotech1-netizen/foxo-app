'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, Save, Lock, Construction, Trash2, AlertTriangle } from 'lucide-react';
import type { Utilisateur } from '@/lib/types/database';
import { FOXO_SLOTS, FOXO_DAYS, FOXO_DAYS_SHORT, slotRangesOverlap, type FoxoDay } from '@/lib/foxo-slots';

// État interne d'une cellule : {existing: id | null, statut: ...}
// existing=null → cellule vide en DB. existing=string → créneau en DB
// avec cet id. Le set 'selected' contient les cells cochées (à exister
// après save). On compare selected vs existingByKey pour déterminer
// les inserts (selected mais pas existing) et les deletes (existing
// mais plus dans selected).
type SlotStatut = 'libre' | 'reserve' | 'bloque';
interface ExistingSlot { id: string; statut: SlotStatut; google_event_id: string | null }
// Créneau en base dont l'heure de début n'appartient pas (ou plus) à la
// grille FOXO_SLOTS — créé avant un changement de grille, ou déplacé à une
// heure libre (contre-proposition acceptée). Il n'a pas de case : on le
// liste à part pour qu'il reste visible et, s'il est libre, supprimable.
interface HorsGrilleSlot { id: string; date: string; heure_debut: string; heure_fin: string; statut: SlotStatut }
const AUCUN_HORS_GRILLE: HorsGrilleSlot[] = [];

const ALLOWED_WEEKS = [1, 2, 4, 8] as const;
type WeekCount = typeof ALLOWED_WEEKS[number];

// Cellule = (dayIdx 0..6, slotIdx 0..FOXO_SLOTS.length-1)
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

// 'HH:MM' (ou 'HH:MM:SS') → '17h00'
function fmtHeure(h: string): string {
  return h.slice(0, 5).replace(':', 'h');
}

// 'YYYY-MM-DD' → 'lun. 12 oct.' (midi local : pas de bascule de jour)
function fmtJour(date: string): string {
  return new Date(date + 'T12:00:00').toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short' });
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
  // Créneaux hors grille de la semaine chargée. `cle` = tech + semaine du
  // chargement : on n'affiche la liste que si elle correspond à l'écran
  // courant (pas de liste d'un autre technicien pendant un rechargement).
  const [horsGrille, setHorsGrille] = useState<{ cle: string; rows: HorsGrilleSlot[] }>({ cle: '', rows: [] });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const msgRef = useRef<HTMLDivElement>(null);

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

  const horsGrilleRows = horsGrille.cle === `${techId}|${isoDate(weekStart)}` ? horsGrille.rows : AUCUN_HORS_GRILLE;

  // Cases de la semaine affichée dont la plage chevauche un créneau hors
  // grille (clé de case → plage du créneau gênant). Tant que ce créneau
  // existe, la case ne peut pas être cochée : on créerait deux créneaux
  // pour la même heure et le même technicien. La route bulk applique la
  // même règle côté serveur, pour toutes les semaines du lot.
  const conflits = useMemo(() => {
    const m = new Map<string, string>();
    for (const h of horsGrilleRows) {
      const dow = new Date(h.date + 'T12:00:00').getDay();
      const dayIdx = dow === 0 ? 6 : dow - 1;
      FOXO_SLOTS.forEach((slot, slotIdx) => {
        if (slotRangesOverlap(slot.heure_debut, slot.heure_fin, h.heure_debut, h.heure_fin)) {
          m.set(cellKey(dayIdx, slotIdx), `${fmtHeure(h.heure_debut)} – ${fmtHeure(h.heure_fin)}`);
        }
      });
    }
    return m;
  }, [horsGrilleRows]);
  // Une case déjà enregistrée reste gérable (décochable) même en conflit.
  function isConflit(k: string): boolean {
    return conflits.has(k) && !existingByKey.has(k);
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
    // Lun–Ven × créneaux de journée (tous sauf ceux marqués `soiree`)
    const next = new Set<string>();
    for (let day = 0; day < 5; day++) {
      FOXO_SLOTS.forEach((slot, slotIdx) => {
        const k = cellKey(day, slotIdx);
        if (!slot.soiree && !isConflit(k)) next.add(k);
      });
    }
    setSelected(next);
  }

  function presetAvecSoirees() {
    // Lun–Ven × tous les créneaux de la grille
    const next = new Set<string>();
    for (let day = 0; day < 5; day++) {
      for (let slotIdx = 0; slotIdx < FOXO_SLOTS.length; slotIdx++) {
        const k = cellKey(day, slotIdx);
        if (!isConflit(k)) next.add(k);
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
    const cle = `${techId}|${isoDate(weekStart)}`;
    const url = `/api/admin/planning/dispos?technicien_id=${encodeURIComponent(techId)}&start_date=${isoDate(weekStart)}&end_date=${isoDate(endDate)}`;
    fetch(url, { signal: ac.signal, cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) return;
        type LoadedSlot = { id: string; date: string; heure_debut: string; heure_fin: string; statut: SlotStatut; google_event_id: string | null };
        const map = new Map<string, ExistingSlot>();
        const sel = new Set<string>();
        const hors: HorsGrilleSlot[] = [];
        for (const s of (data.slots ?? []) as LoadedSlot[]) {
          // Calcule dayIdx (0=lun) depuis la date du slot relative au lundi
          const slotDate = new Date(s.date + 'T00:00:00');
          const dow = slotDate.getDay();
          const dayIdx = dow === 0 ? 6 : dow - 1;
          const hd = s.heure_debut.slice(0, 5);
          const slotIdx = FOXO_SLOTS.findIndex((fs) => fs.heure_debut === hd);
          if (slotIdx < 0) {
            // Heure hors grille (ancienne grille, legacy 1h…) : pas de case,
            // listé dans l'encart « hors grille » sous la grille.
            hors.push({ id: s.id, date: s.date, heure_debut: s.heure_debut, heure_fin: s.heure_fin, statut: s.statut });
            continue;
          }
          const k = cellKey(dayIdx, slotIdx);
          map.set(k, { id: s.id, statut: s.statut, google_event_id: s.google_event_id });
          sel.add(k);
        }
        setExistingByKey(map);
        setSelected(sel);
        setHorsGrille({ cle, rows: hors });
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
      if (!existingByKey.has(k) && !isConflit(k)) toAddKeys.push(k);
    }
    for (const [k, slot] of existingByKey.entries()) {
      if (!selected.has(k)) {
        if (slot.statut === 'libre') toDeleteIds.push(slot.id);
        else skippedReserved.push(k);
      }
    }
    if (deletingId) return;
    if (toAddKeys.length === 0 && toDeleteIds.length === 0) {
      setMsg({ kind: 'err', msg: 'Aucun changement à enregistrer.' });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      let createdCount = 0;
      let skippedOverlap = 0;
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
        skippedOverlap = data.skipped_overlap ?? 0;
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
      if (calendarSynced > 0) parts.push(`${calendarSynced} sync`);
      if (calendarDeleted > 0) parts.push(`${calendarDeleted} retiré(s) du Calendar`);
      if (calendarFailed > 0) parts.push(`${calendarFailed} sync calendar échouée(s)`);
      if (skippedReserved.length > 0) parts.push(`${skippedReserved.length} non supprimé(s) (réservés)`);
      if (skippedOverlap > 0) parts.push(`${skippedOverlap} non créé(s) : chevauchement avec un créneau existant`);
      // Rien de fait à cause de chevauchements = à signaler comme un échec.
      const rienFait = createdCount === 0 && deletedCount === 0 && skippedOverlap > 0;
      setMsg({ kind: rienFait ? 'err' : 'ok', msg: `${techLabel} · ${parts.join(' · ')}` });
      setRefreshTick((t) => t + 1);
      router.refresh();
    } catch (e) {
      setMsg({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
    } finally {
      setSaving(false);
    }
  }

  // Supprime un créneau libre hors grille (et son évènement Google) sans
  // recharger la grille : les cases cochées non enregistrées sont conservées.
  async function supprimerHorsGrille(slot: HorsGrilleSlot) {
    if (deletingId || saving) return;
    const libelle = `${fmtJour(slot.date)} · ${fmtHeure(slot.heure_debut)} – ${fmtHeure(slot.heure_fin)}`;
    if (!window.confirm(`Supprimer le créneau libre du ${libelle} ?`)) return;
    setDeletingId(slot.id);
    setMsg(null);
    try {
      const r = await fetch('/api/admin/planning/dispos/bulk', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot_ids: [slot.id] }),
      });
      const data = await r.json();
      if (!data.ok) {
        setMsg({ kind: 'err', msg: data.error ?? 'Échec de la suppression.' });
        return;
      }
      if ((data.deleted ?? 0) === 0 && (data.skipped_reserved ?? 0) > 0) {
        // Réservé entre-temps : on le garde, affiché comme non supprimable.
        setHorsGrille((h) => ({
          ...h,
          rows: h.rows.map((x) => (x.id === slot.id ? { ...x, statut: 'reserve' as const } : x)),
        }));
        setMsg({ kind: 'err', msg: 'Ce créneau n’est plus libre : il n’a pas été supprimé.' });
        return;
      }
      setHorsGrille((h) => ({ ...h, rows: h.rows.filter((x) => x.id !== slot.id) }));
      setMsg((data.calendar_failed ?? 0) > 0
        ? { kind: 'err', msg: `Créneau du ${libelle} supprimé, mais son évènement « Disponible » n’a pas pu être retiré de Google Calendar : supprimez-le à la main dans l’agenda.` }
        : { kind: 'ok', msg: `Créneau du ${libelle} supprimé.` });
      // Le bouton cliqué disparaît avec sa ligne : on rend le focus au
      // message de résultat plutôt que de le laisser tomber sur <body>.
      setTimeout(() => msgRef.current?.focus(), 0);
      router.refresh();
    } catch (e) {
      setMsg({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
    } finally {
      setDeletingId(null);
    }
  }

  const cellCount = selected.size;
  const totalForWeeks = useMemo(() => cellCount * weeks, [cellCount, weeks]);
  const diffCount = useMemo(() => {
    let adds = 0, removes = 0;
    for (const k of selected) if (!existingByKey.has(k) && !conflits.has(k)) adds++;
    for (const [k, slot] of existingByKey.entries()) {
      if (!selected.has(k) && slot.statut === 'libre') removes++;
    }
    return { adds, removes };
  }, [selected, existingByKey, conflits]);

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
          className="text-[11px] bg-terra-light text-terra border border-terra-mid px-2.5 py-1 rounded font-bold inline-flex items-center gap-1.5"
        >
          <X size={12} /> Tout effacer
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
              conflits={conflits}
              onMouseDownCell={onMouseDown}
              onMouseEnterCell={onMouseEnter}
            />
          ))}
        </div>
      </div>

      {/* Créneaux hors grille (ancienne grille, heure déplacée) */}
      {horsGrilleRows.length > 0 && (
        <div className="mt-3 bg-amber-light border border-sand-border rounded-xl px-3 py-2.5">
          <p className="text-sm font-bold text-ink">
            {horsGrilleRows.length === 1
              ? '1 créneau hors grille cette semaine'
              : `${horsGrilleRows.length} créneaux hors grille cette semaine`}
          </p>
          <p className="text-sm text-ink-mid mt-0.5">
            Leur heure ne correspond à aucune ligne de la grille. Un créneau libre reste proposé tant qu’il n’est pas supprimé, et les cases qu’il chevauche (<AlertTriangle size={12} className="inline" aria-label="avertissement" />) ne peuvent pas être cochées.
          </p>
          <ul className="mt-2 divide-y divide-sand-border">
            {horsGrilleRows.map((s) => {
              const plage = `${fmtHeure(s.heure_debut)} – ${fmtHeure(s.heure_fin)}`;
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm text-ink">
                  <span className="font-semibold">{fmtJour(s.date)}</span>
                  <span className="font-mono tabular-nums">{plage}</span>
                  {s.statut === 'libre' ? (
                    <>
                      <span className="text-ink-mid">Libre</span>
                      <button
                        type="button"
                        onClick={() => supprimerHorsGrille(s)}
                        disabled={deletingId !== null || saving}
                        aria-label={`Supprimer le créneau libre du ${fmtJour(s.date)}, ${plage}`}
                        className="ml-auto inline-flex items-center gap-1.5 text-sm font-bold bg-terra-light text-terra-deep border border-terra-mid px-3 py-1.5 rounded-md hover:brightness-95 disabled:opacity-50"
                      >
                        <Trash2 size={14} />
                        {deletingId === s.id ? 'Suppression…' : 'Supprimer'}
                      </button>
                    </>
                  ) : (
                    <span className="ml-auto inline-flex items-center gap-1.5 text-ink-mid">
                      {s.statut === 'reserve' ? <Lock size={14} /> : <Construction size={14} />}
                      {s.statut === 'reserve' ? 'Réservé — non supprimable ici' : 'Bloqué — non supprimable ici'}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

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
            disabled={saving || deletingId !== null || !techId || (diffCount.adds === 0 && diffCount.removes === 0)}
            className="bg-navy text-white px-3.5 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {saving ? 'Enregistrement…' : (<><Save size={14} /> Enregistrer les dispos</>)}
          </button>
        </div>
      </div>

      {msg && (
        <div ref={msgRef} tabIndex={-1} role="status" className={
          'mt-2 px-3 py-2 text-[12px] rounded-md border font-semibold outline-none focus-visible:ring-2 focus-visible:ring-navy-mid ' +
          (msg.kind === 'ok'
            ? 'bg-ok-light border-ok-mid text-ok'
            : 'bg-terra-light border-terra-mid text-terra')
        }>
          {msg.msg}
        </div>
      )}

      <p className="text-[10px] text-ink-muted italic mt-2 inline-flex flex-wrap items-center gap-1">
        <span>Astuce : les cases déjà cochées en navy sont les créneaux enregistrés en DB.</span>
        <span className="inline-flex items-center gap-1">Décocher une case = suppression au prochain enregistrement (badge ambre <X size={10} className="inline" />).</span>
        <span className="inline-flex items-center gap-1">Les créneaux <Lock size={10} className="inline" /> réservés ou <Construction size={10} className="inline" /> bloqués ne peuvent pas être supprimés ici.</span>
      </p>
      <p className="text-[10px] text-ink-muted mt-1">
        <span className="text-[9px] uppercase font-bold tracking-wider">{totalForWeeks ? `${totalForWeeks} créneaux total après save` : ''}</span>
      </p>
    </div>
  );
}

function Row({
  slot, slotIdx, selected, existingByKey, conflits, onMouseDownCell, onMouseEnterCell,
}: {
  slot: typeof FOXO_SLOTS[number];
  slotIdx: number;
  selected: Set<string>;
  existingByKey: Map<string, ExistingSlot>;
  conflits: Map<string, string>;
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
        // Case vide dont la plage chevauche un créneau hors grille : non
        // cochable tant que ce créneau existe (plage affichée en infobulle).
        const conflit = !existing ? conflits.get(k) : undefined;
        const locked = Boolean(existing && existing.statut !== 'libre') || Boolean(conflit);
        // Visual states :
        // - conflit (chevauche un créneau hors grille) : ambre clair, non-cliquable
        // - locked (réservé/bloqué) : navy strié, non-cliquable
        // - on + existing libre : navy plein (créneau enregistré)
        // - on + nouveau : navy clair avec bordure (sera créé)
        // - off + existing : ambré (sera supprimé après save)
        // - off + nouveau : blanc
        const willDelete = !on && existing && existing.statut === 'libre';
        const willCreate = on && !existing && !conflit;
        let cellClass = 'h-12 border-b border-r border-sand-border last:border-r-0 transition-colors flex items-center justify-center text-[10px] font-bold ';
        if (conflit) {
          cellClass += 'bg-amber-light cursor-not-allowed text-amber-deep ';
        } else if (locked) {
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
              conflit
                ? `Chevauche le créneau hors grille ${conflit} — non disponible tant qu’il existe`
                : locked
                ? (existing?.statut === 'reserve' ? 'Réservé — ne peut pas être supprimé d\'ici' : 'Bloqué')
                : willDelete
                  ? 'Sera supprimé au prochain enregistrement'
                  : willCreate
                    ? 'Sera créé au prochain enregistrement'
                    : on ? 'Enregistré' : 'Vide'
            }
          >
            {conflit
              ? <AlertTriangle size={12} />
              : locked
                ? (existing?.statut === 'reserve' ? <Lock size={12} /> : <Construction size={12} />)
                : willDelete ? <X size={12} /> : null}
          </button>
        );
      })}
    </>
  );
}
