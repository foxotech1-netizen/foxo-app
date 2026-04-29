'use client';

import { useState } from 'react';
import type { TypeIntervention, Utilisateur } from '@/lib/types/database';

const TYPES: TypeIntervention[] = [
  'Fuite canalisation',
  'Fuite chauffage',
  'Fuite infiltration',
  'Surconsommation eau',
  'Autre',
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
  if (allDay) return d.toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return d.toLocaleString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
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
      className="fixed inset-0 bg-navy-deep/50 z-50 flex items-center justify-center p-4 overflow-y-auto"
    >
      <div className="bg-cream border border-sand-border rounded-2xl p-5 w-full max-w-[560px] my-8 dark:bg-[#1C1A16] dark:border-[#2C2A24]">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[14px] font-extrabold text-ink dark:text-[#F0ECE4]">
            📅 Importer cet événement Calendar
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="bg-sand-mid w-8 h-8 rounded-md text-ink-mid dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8]"
            aria-label="Fermer"
          >✕</button>
        </div>

        {/* Aperçu de l'event Calendar */}
        <div className="bg-[#EEF2FF] border border-[#C7D2FE] rounded-lg p-3 mb-4 dark:bg-[#1E1B4B] dark:border-[#3730A3]">
          <div className="text-[13px] font-bold text-[#4338CA] dark:text-[#A5B4FC]">
            {event.title}
          </div>
          <div className="text-[11px] text-[#6366F1] mt-0.5 dark:text-[#A5B4FC]">
            🕒 {fmtDateTime(event.start, event.all_day)}
            {event.location && (
              <>
                <span className="mx-1.5">·</span>
                📍 {event.location}
              </>
            )}
          </div>
          {event.description && (
            <div className="text-[11px] text-ink-mid mt-2 line-clamp-3 dark:text-[#C8C2B8]">
              {event.description}
            </div>
          )}
        </div>

        {event.is_foxo_event && (
          <div className="bg-amber-light border border-[#E8C896] text-[#8A5A1A] rounded-md px-3 py-2 text-[12px] mb-3 dark:bg-[#2A220E] dark:text-[#E8C896] dark:border-[#5A4A30]">
            ⚠ Cet événement a déjà été importé comme intervention FoxO. Tu peux le ré-ouvrir mais pas le ré-importer.
          </div>
        )}

        {/* Form */}
        <div className="space-y-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1 dark:text-[#C8C2B8]">
              Type d&apos;intervention *
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as TypeIntervention)}
              disabled={event.is_foxo_event || submitting}
              className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
            >
              <option value="">— Choisir —</option>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1 dark:text-[#C8C2B8]">
              Adresse d&apos;intervention
            </label>
            <input
              value={adresse}
              onChange={(e) => setAdresse(e.target.value)}
              placeholder="Pré-rempli depuis le lieu de l'event"
              disabled={event.is_foxo_event || submitting}
              className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1 dark:text-[#C8C2B8]">
              Technicien assigné
            </label>
            <select
              value={technicienId}
              onChange={(e) => setTechnicienId(e.target.value)}
              disabled={event.is_foxo_event || submitting}
              className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
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
            <label className="block text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1 dark:text-[#C8C2B8]">
              Description / Notes *
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              disabled={event.is_foxo_event || submitting}
              className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid resize-y dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
            />
          </div>
        </div>

        {error && (
          <div className="mt-3 bg-terra-light border border-terra-mid text-terra rounded-md px-3 py-2 text-[12px] font-semibold">
            {error}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-2 rounded-lg text-[12px] font-bold border border-sand-border bg-white text-ink-mid dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#C8C2B8]"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || event.is_foxo_event}
            className="px-3 py-2 rounded-lg text-[12px] font-bold bg-navy text-white disabled:opacity-50"
          >
            {submitting ? 'Import…' : '📋 Importer comme intervention'}
          </button>
        </div>
      </div>
    </div>
  );
}
