'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { CreneauDisponible, Utilisateur } from '@/lib/types/database';
import { CreateInterventionModal } from './CreateInterventionModal';
import { ReservedSlotModal } from './ReservedSlotModal';
import { BlockedSlotModal } from './BlockedSlotModal';
import { ImportCalendarEventModal, type CalendarEventLite } from './ImportCalendarEventModal';

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

type Creneau = Pick<CreneauDisponible, 'id' | 'date' | 'heure_debut' | 'heure_fin' | 'statut' | 'technicien_id' | 'intervention_id'>
  & { intervention_color?: string | null };

export function PlanningCalendar({
  year,
  month,
  techs,
  creneaux,
  googleConnected,
  prevHref,
  nextHref,
}: {
  year: number;
  month: number;
  techs: Utilisateur[];
  creneaux: Creneau[];
  googleConnected: boolean;
  prevHref: string;
  nextHref: string;
}) {
  const router = useRouter();
  const [techFilter, setTechFilter] = useState<string>('all');
  const [openModal, setOpenModal] = useState<{ kind: 'free' | 'reserved' | 'blocked'; slot: Creneau } | null>(null);

  // Google Calendar events
  const [showGoogle, setShowGoogle] = useState<boolean>(googleConnected);
  const [gcalEvents, setGcalEvents] = useState<CalendarEventLite[]>([]);
  const [gcalLoading, setGcalLoading] = useState(false);
  const [importEvent, setImportEvent] = useState<CalendarEventLite | null>(null);

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

  // Fetch Google Calendar events pour le mois affiché. Re-fetch à chaque
  // changement de mois ou quand le toggle passe de off→on. Ignore les
  // erreurs côté UI (route renvoie events:[] si Google non connecté).
  useEffect(() => {
    if (!googleConnected || !showGoogle) {
      setGcalEvents([]);
      return;
    }
    let mounted = true;
    setGcalLoading(true);
    const lastDay = new Date(year, month + 1, 0).getDate();
    const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const url = `/api/google/calendar-events?from=${from}&to=${to}&t=${Date.now()}`;
    fetch(url, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (!mounted) return;
        if (data.ok) setGcalEvents(data.events ?? []);
      })
      .catch(() => { /* noop */ })
      .finally(() => { if (mounted) setGcalLoading(false); });
    return () => { mounted = false; };
  }, [googleConnected, showGoogle, year, month]);

  // Bucket des events Google par date YYYY-MM-DD (date locale, pas UTC).
  const gcalByDate = useMemo(() => {
    const m = new Map<string, CalendarEventLite[]>();
    for (const e of gcalEvents) {
      if (!e.start) continue;
      const d = new Date(e.start);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!m.has(iso)) m.set(iso, []);
      m.get(iso)!.push(e);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => a.start.localeCompare(b.start));
    }
    return m;
  }, [gcalEvents]);

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

      {/* Toggle Google Calendar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex flex-wrap gap-3">
          <Legend swatch="bg-ok-light border-ok-mid" label="Libre" />
          <Legend swatch="bg-navy-light border-navy-mid" label="Réservé" />
          <Legend swatch="bg-sand-mid border-sand-border" label="Bloqué" />
          {filtered.some((c) => c.intervention_color) && (
            <span className="flex items-center gap-1.5 text-[11px] text-ink-mid">
              <span className="w-3 h-3 rounded-sm border" style={{ background: 'linear-gradient(135deg, #1B3A6B, #7C3AED, #C4622D)' }} />
              Couleur personnalisée
            </span>
          )}
          {googleConnected && showGoogle && (
            <>
              <Legend swatch="bg-[#EEF2FF] border-[#C7D2FE]" label="📅 Google" />
              <Legend swatch="bg-[#F5F3FF] border-[#DDD6FE]" label="✅ FoxO (importé)" />
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {googleConnected ? (
            <label className="flex items-center gap-2 text-[12px] text-ink-mid cursor-pointer dark:text-[#C8C2B8]">
              <input
                type="checkbox"
                checked={showGoogle}
                onChange={(e) => setShowGoogle(e.target.checked)}
                className="accent-[#4F46E5]"
              />
              <span>📅 Afficher Google Calendar{gcalLoading ? ' …' : gcalEvents.length > 0 ? ` (${gcalEvents.length})` : ''}</span>
            </label>
          ) : (
            <span className="text-[11px] text-ink-muted italic dark:text-[#C8C2B8]">
              📅 Google Calendar : <Link href="/admin/parametres" className="underline">Connectez Google dans Paramètres</Link>
            </span>
          )}
        </div>
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
      {importEvent && (
        <ImportCalendarEventModal
          event={importEvent}
          techs={techs}
          onClose={() => setImportEvent(null)}
          onImported={(_id, ref) => {
            // Marque l'event comme importé localement (pas besoin de refetch)
            setGcalEvents((arr) => arr.map((e) =>
              e.id === importEvent.id ? { ...e, is_foxo_event: true } : e,
            ));
            setImportEvent(null);
            // Refresh la page server-side pour voir l'intervention créée
            // dans le pipeline / liste interventions.
            router.refresh();
            // Feedback léger via window pour éviter de mettre du toast UI ici
            if (typeof window !== 'undefined') {
              console.info(`[planning] Intervention ${ref} créée depuis Calendar`);
            }
          }}
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
                {/* Google Calendar events (rendus AVANT les créneaux pour
                    qu'ils flottent en haut visuellement) */}
                {showGoogle && c.inMonth && (gcalByDate.get(c.iso) ?? []).map((ev) => {
                  const time = ev.all_day
                    ? 'Journée'
                    : new Date(ev.start).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
                  const tooltip = [ev.title, time, ev.location].filter(Boolean).join(' · ');
                  return (
                    <button
                      key={`g-${ev.id}`}
                      type="button"
                      onClick={() => setImportEvent(ev)}
                      className="w-full text-left text-[10px] font-semibold rounded px-1.5 py-0.5 truncate hover:brightness-95 cursor-pointer flex items-center gap-1"
                      title={tooltip}
                      style={ev.is_foxo_event
                        ? { background: '#F5F3FF', color: '#7C3AED', borderLeft: '3px solid #A78BFA' }
                        : { background: '#EEF2FF', color: '#4338CA', borderLeft: '3px solid #6366F1' }
                      }
                    >
                      <span className="text-[8px] flex-shrink-0">{ev.is_foxo_event ? '✅' : '📅'}</span>
                      <span className="truncate flex-1">
                        {time === 'Journée' ? ev.title : `${time} ${ev.title}`}
                      </span>
                    </button>
                  );
                })}

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
                    // Couleur personnalisée de l'intervention (si définie)
                    // a priorité sur la couleur tech. Texte blanc pour
                    // contraste max sur la couleur custom (toutes vives).
                    const customColor = cr.intervention_color ?? null;
                    const reserveStyle = customColor
                      ? { background: customColor, color: '#FFFFFF', borderLeft: `3px solid ${customColor}` }
                      : techColor
                        ? { background: techColor.soft, color: techColor.bg, borderLeft: `3px solid ${techColor.bg}` }
                        : { background: '#D6E4F7', color: '#1B3A6B' };
                    return (
                      <button
                        key={cr.id}
                        type="button"
                        onClick={() => setOpenModal({ kind: 'reserved', slot: cr })}
                        className="w-full text-left block text-[10px] font-semibold rounded px-1.5 py-0.5 truncate hover:brightness-95 cursor-pointer"
                        title="Cliquer pour modifier l'intervention"
                        style={reserveStyle}
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
