'use client';

// JournalPanel — fetch + affiche le journal d'événements (intervention_timeline)
// d'un dossier, du plus récent au plus ancien. Lecture seule (route GET
// /api/admin/interventions/[id]/timeline). Extrait tel quel
// d'InterventionsClient.tsx pour réutilisation (fiche client 360°) —
// comportement inchangé. Distinct de HistoriquePanel (récidive), resté
// dans le monolithe.

import { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { SkeletonText } from '@/components/ui/Skeleton';

function fmtJournalDate(iso: string): string {
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

// Copie privée du Block du drawer interventions (le Block d'origine reste
// privé à InterventionsClient.tsx) — même rendu, mêmes tokens.
function Block({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      className="bg-[var(--color-cream)] rounded-card px-3.5 py-3 mb-3 scroll-mt-4"
      style={{ boxShadow: 'var(--shadow-card)' }}
    >
      <div className="flex items-center gap-2.5 mb-2">
        <span className="w-[3px] h-3.5 rounded-sm bg-[var(--color-navy)]"></span>
        <div className="font-sora text-[10px] font-medium text-[var(--color-ink-muted)] uppercase tracking-[0.12em] flex-1">
          {title}
        </div>
      </div>
      <div className="text-[13px] text-[var(--color-ink)] leading-relaxed">{children}</div>
    </div>
  );
}

export function JournalPanel({ interventionId }: { interventionId: string }) {
  type TimelineEvent = {
    id: string;
    type: string;
    message: string | null;
    payload: unknown;
    created_at: string;
    created_by: string | null;
  };

  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => setLoaded(false));
    fetch(`/api/admin/interventions/${interventionId}/timeline`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (!mounted) return;
        if (d.ok) setEvents(d.events ?? []);
        else setError(d.error ?? 'Erreur chargement.');
        setLoaded(true);
      })
      .catch((e) => {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : 'Erreur réseau.');
        setLoaded(true);
      });
    return () => { mounted = false; };
  }, [interventionId]);

  if (!loaded) return <SkeletonText lines={3} />;
  if (error) {
    return (
      <div className="bg-terra-light border border-terra-mid text-terra text-[12px] rounded-md px-3 py-2 font-semibold">
        {error}
      </div>
    );
  }
  if (!events) return null;

  return (
    <Block title={<span className="inline-flex items-center gap-1.5"><CalendarClock size={12} />Journal des événements ({events.length})</span>}>
      {events.length === 0 ? (
        <div className="text-[11px] text-ink-muted italic">
          Aucun événement enregistré pour ce dossier.
        </div>
      ) : (
        <ol className="relative border-l border-sand-mid ml-1 space-y-3">
          {events.map((ev) => (
            <li key={ev.id} className="ml-3 relative">
              <span className="absolute -left-[17px] mt-1 w-2.5 h-2.5 rounded-full bg-[var(--color-navy)]" />
              <div className="text-[12px] text-ink font-medium">{ev.message ?? ev.type}</div>
              <div className="text-[10px] text-ink-muted mt-0.5">
                {fmtJournalDate(ev.created_at)}{ev.created_by ? ` — ${ev.created_by}` : ''}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Block>
  );
}
