'use client';

import { TZ_BRUSSELS } from '@/lib/format';
import { useState } from 'react';
import { Calendar, X, Clock, MapPin, AlertTriangle, ClipboardList } from 'lucide-react';
import type { TypeIntervention, Utilisateur } from '@/lib/types/database';

const TYPES: TypeIntervention[] = [ 'Fuite canalisation', 'Fuite chauffage', 'Fuite infiltration', 'Surconsommation eau', 'Autre',
];

export interface CalendarEventLite {
  id: string;
  title: string;
  start: string;
  end: string;
  description: string;
  location: string;
  is_foxo_event: boolean;
  all_day: boolean;
}

function fmtDateTime(iso: string, allDay: boolean): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (allDay) return d.toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ_BRUSSELS });
  return d.toLocaleString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: TZ_BRUSSELS });
}

export function ImportCalendarEventModal({
  event,
  techs,
  onClose,
  onImported,
}: {
  event: CalendarEventLite;
  techs: Utilisateur[];
  onClose: () => void;
  onImported: (interventionId: string, ref: string) => void;
}) {
  const [type, setType] = useState<TypeIntervention | ''>('');
  const [adresse, setAdresse] = useState(event.location ?? '');
  const [technicienId, setTechnicienId] = useState<string>('');
  const [description, setDescription] = useState(event.description ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (event.is_foxo_event) {
      setError('Cet événement a déjà été importé.');
      return;
    }
    if (!type) {
      setError('Sélectionne un type d\'intervention.');
      return;
    }
    if (!description.trim()) {
      setError('La description ne peut pas être vide.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch('/api/google/calendar-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: event.id,
          event_start_iso: event.start,
          event_end_iso: event.end,
          event_title: event.title,
          event_description: event.description,
          event_location: event.location,
          type,
          technicien_id: technicienId || null,
          adresse,
          description,
        }),
      });
      const data = await r.json();
      if (!data.ok) {
        setError(data.error ?? 'Échec import.');
        return;
      }
      onImported(data.intervention_id, data.ref);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur réseau.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
      className="fixed inset-0 bg-navy-deep/50 z-50 flex items-center justify-center p-4"
    >
      {/* Pattern D4 : header fixe, corps scrollable unique, actions fixes. */}
      <div className="bg-cream border border-sand-border rounded-modal w-full max-w-[560px] max-h-[90vh] flex flex-col">
        <div className="px-5 pt-5 pb-3 flex items-center justify-between flex-shrink-0">
          <h2 className="fxs-block-title text-ink inline-flex items-center gap-1.5">
            <Calendar size={14} /> Importer cet événement Calendar
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="bg-sand-mid w-8 h-8 rounded-lg text-ink-mid inline-flex items-center justify-center"
            aria-label="Fermer"
          ><X size={16} /></button>
        </div>

        <div className="px-5 pb-2 flex-1 min-h-0 overflow-y-auto">
        {/* Aperçu de l'event Calendar */}
        <div className="bg-navy-pale border border-navy-light rounded-lg p-3 mb-4">
          <div className="fx-body font-semibold text-navy">
            {event.title}
          </div>
          <div className="fx-small text-navy mt-0.5 inline-flex items-center gap-1.5 flex-wrap">
            <Clock size={12} /> {fmtDateTime(event.start, event.all_day)}
            {event.location && (
              <>
                <span className="mx-1.5">·</span>
                <MapPin size={12} /> {event.location}
              </>
            )}
          </div>
          {event.description && (
            <div className="fx-small text-ink-mid mt-2 line-clamp-3">
              {event.description}
            </div>
          )}
        </div>

        {event.is_foxo_event && (
          <div className="fx-meta bg-amber-light border border-[var(--color-amber-foxo)]/30 text-amber-ink rounded-lg px-3 py-2 mb-3 inline-flex items-start gap-1.5">
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <span>Cet événement a déjà été importé comme intervention FoxO. Tu peux le ré-ouvrir mais pas le ré-importer.</span>
          </div>
        )}

        {/* Form */}
        <div className="space-y-3">
          <div>
            <label className="fx-eyebrow block font-semibold text-ink-mid mb-1">
              Type d&apos;intervention *
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as TypeIntervention)}
              disabled={event.is_foxo_event || submitting}
              className="fx-body w-full px-3 py-2 border border-sand-border rounded-lg bg-cream outline-none focus:border-navy-mid"
            >
              <option value="">— Choisir —</option>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div>
            <label className="fx-eyebrow block font-semibold text-ink-mid mb-1">
              Adresse d&apos;intervention
            </label>
            <input
              value={adresse}
              onChange={(e) => setAdresse(e.target.value)}
              placeholder="Pré-rempli depuis le lieu de l'event"
              disabled={event.is_foxo_event || submitting}
              className="fx-body w-full px-3 py-2 border border-sand-border rounded-lg bg-cream outline-none focus:border-navy-mid"
            />
          </div>

          <div>
            <label className="fx-eyebrow block font-semibold text-ink-mid mb-1">
              Technicien assigné
            </label>
            <select
              value={technicienId}
              onChange={(e) => setTechnicienId(e.target.value)}
              disabled={event.is_foxo_event || submitting}
              className="fx-body w-full px-3 py-2 border border-sand-border rounded-lg bg-cream outline-none focus:border-navy-mid"
            >
              <option value="">— Non assigné —</option>
              {techs.map((t) => (
                <option key={t.id} value={t.id}>
                  {[t.prenom, t.nom].filter(Boolean).join(' ') || t.email || t.id}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="fx-eyebrow block font-semibold text-ink-mid mb-1">
              Description / Notes *
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              disabled={event.is_foxo_event || submitting}
              className="fx-body w-full px-3 py-2 border border-sand-border rounded-lg bg-cream outline-none focus:border-navy-mid resize-y"
            />
          </div>
        </div>

        {error && (
          <div className="fx-label mt-3 bg-terra-light border border-terra-mid text-terra rounded-lg px-3 py-2 font-semibold">
            {error}
          </div>
        )}
        </div>

        <div className="px-5 py-4 border-t border-sand-border flex justify-end gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="fx-label px-3 py-2 rounded-lg font-semibold border border-sand-border bg-cream text-ink-mid"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || event.is_foxo_event}
            className="fx-label px-3 py-2 rounded-lg font-semibold bg-navy text-cream disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {submitting ? 'Import…' : (<><ClipboardList size={14} /> Importer comme intervention</>)}
          </button>
        </div>
      </div>
    </div>
  );
}
