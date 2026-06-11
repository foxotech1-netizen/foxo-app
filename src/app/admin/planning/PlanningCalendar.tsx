'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Calendar, CheckCircle2, Construction, Check, RefreshCw, Sparkles } from 'lucide-react';
import type { CreneauDisponible, Utilisateur } from '@/lib/types/database';
import { CreateInterventionModal } from './CreateInterventionModal';
import { ReservedSlotModal } from './ReservedSlotModal';
import { BlockedSlotModal } from './BlockedSlotModal';
import { ImportCalendarEventModal, type CalendarEventLite } from './ImportCalendarEventModal';
import { ProposeSlotModal } from './ProposeSlotModal';
import { FOXO_SLOTS, FOXO_DAYS } from '@/lib/foxo-slots';

const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];
const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const VIEW_STORAGE_KEY = 'foxo-planning-view';
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Palette de fallback si un technicien n'a pas de couleur personnalisée
// (utilisateurs.couleur IS NULL). Couleurs distinguables alignées avec
// la palette FoxO.
const TECH_COLORS_FALLBACK = [
  { bg: '#1B3A6B', soft: '#D6E4F7' },  // navy
  { bg: '#A17244', soft: '#F0DCC4' },  // ambre
  { bg: '#1F6B45', soft: '#D4EDE2' },  // ok
  { bg: '#C4622D', soft: '#F7EDE5' },  // terra
];

// Convertit un hex #RRGGBB en version "soft" (mix avec blanc 80%).
// Utilisée pour les fonds de cellules réservées en vue mois (lecture
// confortable du texte navy/foncé sur fond clair).
function hexToSoft(hex: string): string {
  const m = hex.match(/^#([0-9A-Fa-f]{6})$/);
  if (!m) return '#D6E4F7';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  // Mix 20% couleur, 80% blanc (#FFFFFF) → version pastel
  const sr = Math.round(r * 0.2 + 255 * 0.8);
  const sg = Math.round(g * 0.2 + 255 * 0.8);
  const sb = Math.round(b * 0.2 + 255 * 0.8);
  return `#${[sr, sg, sb].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export interface PlanningColors {
  libre: string;
  reserve: string;
  bloque: string;
  google: string;
  foxo_importe: string;
}

type Creneau = Pick<CreneauDisponible, 'id' | 'date' | 'heure_debut' | 'heure_fin' | 'statut' | 'technicien_id' | 'intervention_id'>
  & {
    intervention_color?: string | null;
    intervention_ref?: string | null;
    client_name?: string | null;
  };

export function PlanningCalendar({
  year,
  month,
  techs,
  creneaux,
  googleConnected,
  planningColors,
  prevHref,
  nextHref,
}: {
  year: number;
  month: number;
  techs: Utilisateur[];
  creneaux: Creneau[];
  googleConnected: boolean;
  planningColors: PlanningColors;
  prevHref: string;
  nextHref: string;
}) {
  const router = useRouter();
  const [techFilter, setTechFilter] = useState<string>('all');
  const [openModal, setOpenModal] = useState<{ kind: 'free' | 'reserved' | 'blocked'; slot: Creneau } | null>(null);
  const [showPropose, setShowPropose] = useState(false);

  // Mode d'affichage — Semaine (défaut) ou Mois.
  // Persistant via localStorage 'foxo-planning-view'. Note : on ne peut
  // pas lire localStorage à l'init (SSR mismatch) → on initialise à 'week'
  // puis on hydrate dans un useEffect.
  const [viewMode, setViewModeState] = useState<'week' | 'month'>('week');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const v = window.localStorage.getItem(VIEW_STORAGE_KEY);
      if (v === 'month' || v === 'week') setViewModeState(v);
    } catch { /* noop */ }
  }, []);
  const setViewMode = (v: 'week' | 'month') => {
    setViewModeState(v);
    try { window.localStorage.setItem(VIEW_STORAGE_KEY, v); } catch { /* noop */ }
  };
  // Lundi de la semaine affichée. Initialisé sur la semaine du jour.
  const [weekMonday, setWeekMonday] = useState<Date>(() => {
    const now = new Date();
    const dow = now.getDay();
    const offset = dow === 0 ? -6 : 1 - dow;
    const m = new Date(now);
    m.setDate(now.getDate() + offset);
    m.setHours(0, 0, 0, 0);
    return m;
  });

  // Google Calendar events
  const [showGoogle, setShowGoogle] = useState<boolean>(googleConnected);
  const [gcalEvents, setGcalEvents] = useState<CalendarEventLite[]>([]);
  const [gcalLoading, setGcalLoading] = useState(false);
  const [importEvent, setImportEvent] = useState<CalendarEventLite | null>(null);

  function refresh() { router.refresh(); }

  // Crée un créneau "libre" à la volée (depuis une cellule "+" en vue
  // semaine), puis ouvre la modal de création d'intervention. Le tech
  // est celui sélectionné dans le filtre — quand le filtre est "all"
  // on ne montre pas le bouton "+".
  const [creatingSlot, setCreatingSlot] = useState(false);
  async function createSlotAndOpenModal(date: string, slotIdx: number, technicien_id: string) {
    if (creatingSlot) return;
    setCreatingSlot(true);
    try {
      const slot = FOXO_SLOTS[slotIdx];
      if (!slot) return;
      // Calcule le day-index (0=lundi) depuis la date pour le payload bulk
      const d = new Date(date + 'T12:00:00');
      const dow = d.getDay();
      const dayIdx = dow === 0 ? 6 : dow - 1;
      // start_date = lundi de la semaine de la date cliquée
      const monday = new Date(d);
      monday.setDate(d.getDate() - dayIdx);
      monday.setHours(0, 0, 0, 0);
      const r = await fetch('/api/admin/planning/dispos/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          technicien_id,
          weeks: 1,
          start_date: isoDate(monday),
          slots: [{
            day: FOXO_DAYS[dayIdx],
            heure_debut: slot.heure_debut,
            heure_fin: slot.heure_fin,
          }],
        }),
      });
      const data = await r.json();
      if (!data.ok || !data.ids?.[0]) {
        // Si le créneau existe déjà côté DB, refresh pour le faire apparaître
        if (data.ok) router.refresh();
        return;
      }
      const newId = data.ids[0] as string;
      setOpenModal({
        kind: 'free',
        slot: {
          id: newId,
          date,
          heure_debut: slot.heure_debut,
          heure_fin: slot.heure_fin,
          statut: 'libre',
          technicien_id,
          intervention_id: null,
        },
      });
      router.refresh();
    } catch {
      /* noop */
    } finally {
      setCreatingSlot(false);
    }
  }

  // Map techId → { bg, soft } : utilise utilisateurs.couleur si défini,
  // sinon fallback sur la palette historique (navy/ambre/ok/terra).
  // soft = version pastel pour les fonds de cellules.
  const techColorMap = useMemo(() => {
    const m = new Map<string, { bg: string; soft: string }>();
    techs.forEach((t, i) => {
      if (t.couleur) {
        m.set(t.id, { bg: t.couleur, soft: hexToSoft(t.couleur) });
      } else {
        m.set(t.id, TECH_COLORS_FALLBACK[i % TECH_COLORS_FALLBACK.length]);
      }
    });
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
    let from: string, to: string;
    if (viewMode === 'week') {
      const last = new Date(weekMonday);
      last.setDate(last.getDate() + 6);
      from = isoDate(weekMonday);
      to = isoDate(last);
    } else {
      const lastDay = new Date(year, month + 1, 0).getDate();
      from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    }
    const url = `/api/google/calendar-events?from=${from}&to=${to}&t=${Date.now()}`;
    fetch(url, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (!mounted) return;
        if (data.ok) setGcalEvents(data.events ?? []);
      })
      .catch((e) => console.warn('[admin/planning] chargement événements Google Calendar échoué (best-effort)', e))
      .finally(() => { if (mounted) setGcalLoading(false); });
    return () => { mounted = false; };
  }, [googleConnected, showGoogle, viewMode, weekMonday, year, month]);

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

  // 7 dates de la semaine affichée (lundi → dimanche)
  const weekDates = useMemo(() => {
    const arr: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekMonday);
      d.setDate(weekMonday.getDate() + i);
      arr.push(d);
    }
    return arr;
  }, [weekMonday]);

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

        <div className="flex flex-wrap gap-2 items-center">
          {/* Proposer un créneau — toujours visible (indépendant du filtre tech) */}
          <button
            type="button"
            onClick={() => setShowPropose(true)}
            className="px-3 py-1.5 rounded-md text-[12px] font-bold border border-navy bg-navy text-white hover:opacity-90 inline-flex items-center gap-1.5"
            title="Trouver les meilleurs créneaux libres selon l'adresse et l'urgence"
          >
            <Sparkles size={14} /> Proposer un créneau
          </button>

          {/* Toggle Semaine / Mois */}
          <div className="flex bg-sand-mid rounded-md p-0.5 dark:bg-[rgba(255,255,255,.06)]">
            <button
              type="button"
              onClick={() => setViewMode('week')}
              className={
                'px-3 py-1 rounded text-[11px] font-bold ' +
                (viewMode === 'week' ? 'bg-navy text-white' : 'text-ink-mid')
              }
            >
              Semaine
            </button>
            <button
              type="button"
              onClick={() => setViewMode('month')}
              className={
                'px-3 py-1 rounded text-[11px] font-bold ' +
                (viewMode === 'month' ? 'bg-navy text-white' : 'text-ink-mid')
              }
            >
              Mois
            </button>
          </div>

          {/* Navigation week — boutons internes (state weekMonday) */}
          {viewMode === 'week' && (
            <>
              <button
                type="button"
                onClick={() => {
                  const d = new Date(weekMonday);
                  d.setDate(d.getDate() - 7);
                  setWeekMonday(d);
                }}
                className="bg-sand-mid w-8 h-8 rounded-md text-ink-mid flex items-center justify-center hover:bg-sand-border dark:bg-[rgba(255,255,255,.06)]"
              >‹</button>
              <button
                type="button"
                onClick={() => {
                  const now = new Date();
                  const dow = now.getDay();
                  const offset = dow === 0 ? -6 : 1 - dow;
                  const m = new Date(now);
                  m.setDate(now.getDate() + offset);
                  m.setHours(0, 0, 0, 0);
                  setWeekMonday(m);
                }}
                className="bg-sand-mid px-2 h-8 rounded-md text-ink-mid text-[11px] font-bold hover:bg-sand-border dark:bg-[rgba(255,255,255,.06)]"
              >
                Aujourd&apos;hui
              </button>
              <button
                type="button"
                onClick={() => {
                  const d = new Date(weekMonday);
                  d.setDate(d.getDate() + 7);
                  setWeekMonday(d);
                }}
                className="bg-sand-mid w-8 h-8 rounded-md text-ink-mid flex items-center justify-center hover:bg-sand-border dark:bg-[rgba(255,255,255,.06)]"
              >›</button>
            </>
          )}

          {/* Navigation mois — Links existants (URL state) */}
          {viewMode === 'month' && (
            <>
              <Link
                href={prevHref}
                className="bg-sand-mid w-8 h-8 rounded-md text-ink-mid flex items-center justify-center hover:bg-sand-border"
              >‹</Link>
              <Link
                href={nextHref}
                className="bg-sand-mid w-8 h-8 rounded-md text-ink-mid flex items-center justify-center hover:bg-sand-border"
              >›</Link>
            </>
          )}
        </div>
      </div>

      <div className="text-[11px] text-ink-muted mb-3">
        {viewMode === 'week'
          ? (() => {
              const sun = new Date(weekMonday);
              sun.setDate(weekMonday.getDate() + 6);
              const sameMonth = weekMonday.getMonth() === sun.getMonth();
              const sameYear = weekMonday.getFullYear() === sun.getFullYear();
              if (sameMonth && sameYear) {
                return `${weekMonday.getDate()} — ${sun.getDate()} ${MONTHS_SHORT[sun.getMonth()]} ${sun.getFullYear()}`;
              }
              if (sameYear) {
                return `${weekMonday.getDate()} ${MONTHS_SHORT[weekMonday.getMonth()]} — ${sun.getDate()} ${MONTHS_SHORT[sun.getMonth()]} ${sun.getFullYear()}`;
              }
              return `${weekMonday.getDate()} ${MONTHS_SHORT[weekMonday.getMonth()]} ${weekMonday.getFullYear()} — ${sun.getDate()} ${MONTHS_SHORT[sun.getMonth()]} ${sun.getFullYear()}`;
            })()
          : <span className="capitalize">{MONTHS[month]} {year} · {counts.libre} libre · {counts.reserve} réservé · {counts.bloque} bloqué</span>
        }
      </div>

      {/* Toggle Google Calendar + légende dynamique avec les couleurs settings */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex flex-wrap gap-3 items-center">
          <LegendSwatch color={planningColors.libre} label="Libre" />
          <LegendSwatch color={planningColors.reserve} label="Réservé" />
          <LegendSwatch color={planningColors.bloque} label="Bloqué" />
          {techs.map((t, i) => {
            const c = techColorMap.get(t.id);
            if (!c) return null;
            const display = [t.prenom, t.nom].filter(Boolean).join(' ') || t.email || `T.${i + 1}`;
            return (
              <LegendSwatch key={t.id} color={c.bg} label={`T.${i + 1} — ${display}`} />
            );
          })}
          {filtered.some((c) => c.intervention_color) && (
            <span className="flex items-center gap-1.5 text-[11px] text-ink-mid">
              <span className="w-3 h-3 rounded-sm border" style={{ background: 'linear-gradient(135deg, #1B3A6B, #7C3AED, #C4622D)' }} />
              Couleur custom
            </span>
          )}
          {googleConnected && showGoogle && (
            <>
              <LegendSwatch color={planningColors.google} label={<span className="inline-flex items-center gap-1"><Calendar size={12} /> Google</span>} />
              <LegendSwatch color={planningColors.foxo_importe} label={<span className="inline-flex items-center gap-1"><CheckCircle2 size={12} /> FoxO (importé)</span>} />
            </>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {googleConnected ? (
            <>
              <label className="flex items-center gap-2 text-[12px] text-ink-mid cursor-pointer">
                <input
                  type="checkbox"
                  checked={showGoogle}
                  onChange={(e) => setShowGoogle(e.target.checked)}
                  className="accent-[#4F46E5]"
                />
                <span className="inline-flex items-center gap-1.5"><Calendar size={14} /> Afficher Google Calendar{gcalLoading ? ' …' : gcalEvents.length > 0 ? ` (${gcalEvents.length})` : ''}</span>
              </label>
              <ResyncButton />
            </>
          ) : (
            <span className="text-[11px] text-ink-muted italic inline-flex items-center gap-1.5">
              <Calendar size={12} /> Google Calendar : <Link href="/admin/parametres" className="underline">Connectez Google dans Paramètres</Link>
            </span>
          )}
        </div>
      </div>

      {/* Modaux */}
      {showPropose && (
        <ProposeSlotModal
          onClose={() => setShowPropose(false)}
          onSelect={(slot) => {
            setShowPropose(false);
            // Ouvre la fenêtre de création existante sur le créneau proposé.
            // Le creneau_id pointe sur une ligne creneaux_disponibles libre
            // réelle — on construit un objet conforme au type Creneau local
            // en remplissant les champs non fournis avec des valeurs neutres.
            setOpenModal({
              kind: 'free',
              slot: {
                id: slot.id,
                date: slot.date,
                heure_debut: slot.heure_debut,
                heure_fin: slot.heure_fin,
                statut: 'libre',
                technicien_id: slot.technicien_id,
                intervention_id: null,
              },
            });
          }}
        />
      )}
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

      {/* Calendar — vue Semaine (5 créneaux fixes FoxO × 7 jours) */}
      {viewMode === 'week' && (
        <div className="bg-cream rounded-xl border border-sand-border overflow-hidden">
          <div
            className="grid"
            style={{ gridTemplateColumns: '90px repeat(7, 1fr)' }}
          >
            {/* Header — coin vide + 7 jours avec date */}
            <div className="bg-sand border-b border-r border-sand-border" />
            {weekDates.map((d) => {
              const iso = isoDate(d);
              const isToday = iso === todayStr;
              return (
                <div
                  key={iso}
                  className="bg-sand text-center py-2 border-b border-r border-sand-border last:border-r-0"
                >
                  <div className={
                    'text-[10px] font-bold uppercase tracking-wider ' +
                    (isToday ? 'text-navy' : 'text-ink-muted')
                  }>
                    {DAYS[(d.getDay() + 6) % 7]}
                  </div>
                  <div className={
                    'mt-0.5 text-[13px] font-extrabold inline-flex items-center justify-center w-7 h-7 ' +
                    (isToday
                      ? 'rounded-full bg-navy text-white'
                      : 'text-ink-mid')
                  }>
                    {d.getDate()}
                  </div>
                </div>
              );
            })}

            {/* Lignes : créneau FoxO + 7 cases */}
            {FOXO_SLOTS.map((slot, slotIdx) => (
              <Fragment key={slotIdx}>
                <div className="bg-sand border-b border-r border-sand-border text-center py-2">
                  <div className="text-[11px] font-mono font-extrabold text-ink">
                    {slot.heure_debut}
                  </div>
                  <div className="text-[9px] font-mono text-ink-muted">
                    →{slot.heure_fin}
                  </div>
                </div>
                {weekDates.map((d) => {
                  const iso = isoDate(d);
                  const cellCreneaux = (byDate.get(iso) ?? []).filter((c) => c.heure_debut.slice(0, 5) === slot.heure_debut);
                  const slotStartH = parseInt(slot.heure_debut.split(':')[0], 10);
                  const slotEndH = parseInt(slot.heure_fin.split(':')[0], 10);
                  // Les events Google qui tombent dans la fenêtre du créneau
                  const cellGcal = (gcalByDate.get(iso) ?? []).filter((ev) => {
                    if (ev.all_day) return slotIdx === 0;
                    const dt = new Date(ev.start);
                    const evH = dt.getHours();
                    return evH >= slotStartH && evH < slotEndH;
                  });
                  const isTodayCell = iso === todayStr;
                  const showPlus = cellCreneaux.length === 0
                    && techFilter !== 'all'
                    && techFilter !== ''
                    && !creatingSlot;
                  return (
                    <div
                      key={`${iso}-${slotIdx}`}
                      className={
                        'border-b border-r border-sand-border last:border-r-0 min-h-[64px] p-1 space-y-0.5 relative ' +
                        (isTodayCell
                          ? 'bg-navy-pale dark:bg-[rgba(122,168,232,.08)]'
                          : 'bg-cream')
                      }
                    >
                      {showGoogle && cellGcal.map((ev) => {
                        const time = ev.all_day
                          ? 'Journée'
                          : new Date(ev.start).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
                        const tooltip = [ev.title, time, ev.location].filter(Boolean).join(' · ');
                        return (
                          <button
                            key={`g-${ev.id}`}
                            type="button"
                            onClick={() => setImportEvent(ev)}
                            className="w-full text-left text-[10px] font-semibold rounded px-1 py-0.5 truncate flex items-center gap-1 hover:brightness-95 cursor-pointer"
                            title={tooltip}
                            style={ev.is_foxo_event
                              ? { background: hexToSoft(planningColors.foxo_importe), color: planningColors.foxo_importe, borderLeft: `3px solid ${planningColors.foxo_importe}` }
                              : { background: hexToSoft(planningColors.google), color: planningColors.google, borderLeft: `3px solid ${planningColors.google}` }
                            }
                          >
                            <span className="flex-shrink-0">{ev.is_foxo_event ? <CheckCircle2 size={10} /> : <Calendar size={10} />}</span>
                            <span className="truncate flex-1">{ev.title}</span>
                          </button>
                        );
                      })}
                      {cellCreneaux.map((cr) => {
                        const techIdx = cr.technicien_id ? techs.findIndex((t) => t.id === cr.technicien_id) : -1;
                        const techColor = cr.technicien_id ? techColorMap.get(cr.technicien_id) : null;
                        const techBadge = techIdx >= 0 ? `T.${techIdx + 1}` : null;

                        if (cr.statut === 'libre') {
                          return (
                            <button
                              key={cr.id}
                              type="button"
                              onClick={() => setOpenModal({ kind: 'free', slot: cr })}
                              className="w-full text-left rounded px-1.5 py-1 hover:brightness-95 cursor-pointer flex items-center gap-1 border"
                              title="Cliquer pour planifier une intervention"
                              style={{
                                background: hexToSoft(planningColors.libre),
                                borderColor: planningColors.libre,
                                color: planningColors.libre,
                              }}
                            >
                              <span className="text-[10px] font-bold flex-1 truncate">Libre</span>
                              {techBadge && techColor && (
                                <span className="text-[9px] font-extrabold px-1 py-px rounded" style={{ background: techColor.bg, color: '#FFFFFF' }}>
                                  {techBadge}
                                </span>
                              )}
                            </button>
                          );
                        }
                        if (cr.statut === 'reserve') {
                          const customColor = cr.intervention_color ?? null;
                          // Priorité : couleur custom intervention > couleur tech > couleur réservé par défaut
                          const bg = customColor ?? techColor?.bg ?? planningColors.reserve;
                          const clientLabel = cr.client_name || cr.intervention_ref || 'Réservé';
                          return (
                            <button
                              key={cr.id}
                              type="button"
                              onClick={() => setOpenModal({ kind: 'reserved', slot: cr })}
                              className="w-full text-left rounded px-1.5 py-1 hover:brightness-95 cursor-pointer flex items-center gap-1"
                              title={`Cliquer pour modifier — ${clientLabel}`}
                              style={{ background: bg, color: '#FFFFFF', borderLeft: techColor ? `3px solid ${techColor.bg}` : undefined }}
                            >
                              <Check size={10} />
                              <span className="text-[11px] font-bold flex-1 truncate">{clientLabel}</span>
                              {techBadge && techColor && (
                                <span className="text-[9px] font-extrabold px-1 py-px rounded" style={{ background: techColor.bg, color: '#FFFFFF', filter: 'brightness(1.1)' }}>
                                  {techBadge}
                                </span>
                              )}
                            </button>
                          );
                        }
                        // bloqué — non cliquable
                        return (
                          <div
                            key={cr.id}
                            className="w-full rounded px-1.5 py-1 bg-sand-mid text-ink-muted text-[10px] font-bold flex items-center gap-1"
                            title="Créneau bloqué"
                          >
                            <Construction size={10} />
                            <span className="flex-1 truncate">Bloqué</span>
                            {techBadge && <span className="text-[9px] opacity-70">{techBadge}</span>}
                          </div>
                        );
                      })}
                      {showPlus && (
                        <button
                          type="button"
                          onClick={() => createSlotAndOpenModal(iso, slotIdx, techFilter)}
                          className="absolute inset-0 flex items-center justify-center text-[18px] font-bold text-ink-muted/30 hover:text-navy hover:bg-sand-hover/50 transition-colors cursor-pointer/30"
                          title="Créer un créneau libre pour ce technicien"
                          aria-label="Créer un créneau"
                        >
                          +
                        </button>
                      )}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      )}

      {/* Calendar — vue Mois (legacy) */}
      {viewMode === 'month' && (
      <div className="bg-cream rounded-xl border border-sand-border overflow-hidden">
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
                        ? { background: hexToSoft(planningColors.foxo_importe), color: planningColors.foxo_importe, borderLeft: `3px solid ${planningColors.foxo_importe}` }
                        : { background: hexToSoft(planningColors.google), color: planningColors.google, borderLeft: `3px solid ${planningColors.google}` }
                      }
                    >
                      <span className="flex-shrink-0">{ev.is_foxo_event ? <CheckCircle2 size={10} /> : <Calendar size={10} />}</span>
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
                            ? { background: planningColors.libre, color: '#FFFFFF', borderLeft: `3px solid ${techColor.bg}` }
                            : { background: planningColors.libre, color: '#FFFFFF' }
                        }
                      >
                        {time}
                      </button>
                    );
                  }
                  if (cr.statut === 'reserve') {
                    // Priorité : couleur intervention > couleur tech > couleur réservé par défaut
                    const customColor = cr.intervention_color ?? null;
                    const reserveStyle = customColor
                      ? { background: customColor, color: '#FFFFFF', borderLeft: `3px solid ${customColor}` }
                      : techColor
                        ? { background: techColor.soft, color: techColor.bg, borderLeft: `3px solid ${techColor.bg}` }
                        : { background: hexToSoft(planningColors.reserve), color: planningColors.reserve, borderLeft: `3px solid ${planningColors.reserve}` };
                    return (
                      <button
                        key={cr.id}
                        type="button"
                        onClick={() => setOpenModal({ kind: 'reserved', slot: cr })}
                        className="w-full text-left text-[10px] font-semibold rounded px-1.5 py-0.5 truncate hover:brightness-95 cursor-pointer inline-flex items-center gap-1 w-full"
                        title="Cliquer pour modifier l'intervention"
                        style={reserveStyle}
                      >
                        <span>{time}</span>
                        <Check size={10} />
                      </button>
                    );
                  }
                  return (
                    <button
                      key={cr.id}
                      type="button"
                      onClick={() => setOpenModal({ kind: 'blocked', slot: cr })}
                      className="w-full text-left text-[10px] font-semibold rounded px-1.5 py-0.5 truncate bg-sand-mid text-ink-muted hover:bg-sand-border cursor-pointer"
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
      )}
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

// Swatch coloré inline (vs Legend qui utilise des classes Tailwind).
// Utilisé pour les couleurs dynamiques des paramètres planning.
function LegendSwatch({ color, label }: { color: string; label: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-ink-mid">
      <span className="w-3 h-3 rounded-sm border" style={{ background: color, borderColor: color }} />
      {label}
    </span>
  );
}

// Bouton "Resynchroniser" — appelle POST /api/admin/planning/dispos/resync
// qui crée les events Calendar manquants pour les créneaux libres futurs
// sans google_event_id. Utile après reconnexion Google ou après un import
// massif sans sync.
function ResyncButton() {
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  async function run() {
    if (pending) return;
    setMsg(null);
    setPending(true);
    try {
      const r = await fetch('/api/admin/planning/dispos/resync', { method: 'POST' });
      const data = await r.json();
      if (!data.ok) {
        setMsg({ kind: 'err', msg: data.error ?? 'Échec resync.' });
        return;
      }
      const parts: string[] = [];
      if (data.synced > 0) parts.push(`${data.synced} synchronisé(s)`);
      if (data.failed > 0) parts.push(`${data.failed} échec(s)`);
      if (data.total === 0) parts.push('rien à resync');
      if (data.truncated) parts.push('100 max — relance pour continuer');
      setMsg({ kind: 'ok', msg: parts.join(' · ') });
    } catch (e) {
      setMsg({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="text-[11px] bg-sand-mid text-ink-mid border border-sand-border px-2.5 py-1 rounded font-bold hover:bg-sand-hover disabled:opacity-50 dark:bg-[rgba(255,255,255,.06)] inline-flex items-center gap-1.5"
        title="Crée les events Google Calendar manquants pour les créneaux libres futurs"
      >
        <RefreshCw size={12} className={pending ? 'animate-spin' : ''} />
        {pending ? 'Resync en cours…' : 'Resync Google Calendar'}
      </button>
      {msg && (
        <span className={
          'text-[10px] font-bold ' +
          (msg.kind === 'ok' ? 'text-ok' : 'text-terra')
        }>
          {msg.msg}
        </span>
      )}
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
