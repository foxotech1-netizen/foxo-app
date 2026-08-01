'use client';

// Bloc « Résumé IA » de la fiche client (Mode Appel phase 5) — complète le
// bandeau Situation mécanique (qui reste toujours visible). Génération
// UNIQUEMENT au clic : POST /api/admin/clients/[id]/resume (cache par
// fraîcheur côté serveur ; « Régénérer » force). 5-10 s normales.

import { useState } from 'react';
import { Sparkles } from 'lucide-react';

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fr-BE', {
      timeZone: 'Europe/Brussels',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function ResumeIASection({
  clientId,
  resumeInitial,
  genereLe,
}: {
  clientId: string;
  resumeInitial: string | null;
  genereLe: string | null;
}) {
  const [resume, setResume] = useState<string | null>(resumeInitial);
  const [date, setDate] = useState<string | null>(genereLe);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate(force: boolean) {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/clients/${clientId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error ?? `Erreur ${r.status}`);
      setResume(d.resume as string);
      setDate(d.genere_le as string);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur réseau.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-navy-pale border border-navy-light rounded-2xl px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-navy shrink-0">
          <Sparkles size={12} /> IA
        </span>
        {resume ? (
          <>
            <span className="text-[10px] text-ink-muted">
              Résumé IA du {date ? fmtDateTime(date) : '—'}
            </span>
            <button
              type="button"
              onClick={() => generate(true)}
              disabled={loading}
              className="ml-auto text-[11px] font-bold text-navy hover:underline disabled:opacity-50 disabled:no-underline"
            >
              {loading ? 'Génération en cours…' : 'Régénérer'}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => generate(false)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold bg-navy text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Génération en cours…' : 'Résumer la situation (IA)'}
          </button>
        )}
      </div>
      {resume && (
        <p className="text-[13px] text-ink mt-2 leading-relaxed whitespace-pre-wrap">
          {resume}
        </p>
      )}
      {error && (
        <div className="mt-2 px-3 py-1.5 bg-terra-light border border-terra-mid text-terra rounded-md text-[11px] font-semibold">
          {error}
        </div>
      )}
    </div>
  );
}
