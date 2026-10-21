'use client';

// Section « Notes d'appel » de la fiche client (Mode Appel phase 4).
// Saisie rapide en haut (Ctrl+Entrée soumet, rattachement optionnel à un
// dossier du client — liste passée en props, aucun fetch supplémentaire),
// liste horodatée en dessous (repli à 10). Ajout optimiste : la note
// apparaît immédiatement, rollback + message sobre si l'API échoue.

import { useEffect, useRef, useState } from 'react';
import { Phone } from 'lucide-react';
import type { NoteAppel } from '@/app/api/admin/clients/[id]/notes/route';

const VISIBLE = 10;

export interface DossierOption {
  id: string;
  ref: string | null;
  date: string; // ISO — date_effective du dossier
}

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

function fmtDateShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('fr-BE', {
      day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Brussels',
    });
  } catch {
    return iso;
  }
}

export function NotesAppelSection({
  clientId,
  dossiers,
}: {
  clientId: string;
  dossiers: DossierOption[];
}) {
  const [notes, setNotes] = useState<NoteAppel[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [contenu, setContenu] = useState('');
  const [ivId, setIvId] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const tempIdRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    fetch(`/api/admin/clients/${clientId}/notes`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (!mounted) return;
        if (d.ok) setNotes(d.notes ?? []);
        else setLoadError(d.error ?? 'Erreur chargement.');
      })
      .catch((e) => {
        if (!mounted) return;
        setLoadError(e instanceof Error ? e.message : 'Erreur réseau.');
      });
    return () => { mounted = false; };
  }, [clientId]);

  async function submit() {
    const text = contenu.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);

    // Ajout optimiste.
    const tempId = `temp-${++tempIdRef.current}`;
    const dossier = ivId ? dossiers.find((d) => d.id === ivId) ?? null : null;
    const optimistic: NoteAppel = {
      id: tempId,
      client_id: clientId,
      intervention_id: dossier?.id ?? null,
      intervention_ref: dossier?.ref ?? null,
      contenu: text,
      created_by: null,
      created_at: new Date().toISOString(),
    };
    setNotes((prev) => [optimistic, ...(prev ?? [])]);

    try {
      const r = await fetch(`/api/admin/clients/${clientId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contenu: text, intervention_id: ivId || undefined }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error ?? `Erreur ${r.status}`);
      setNotes((prev) => (prev ?? []).map((n) => (n.id === tempId ? (d.note as NoteAppel) : n)));
      setContenu('');
      setIvId('');
    } catch (e) {
      // Rollback de l'optimiste.
      setNotes((prev) => (prev ?? []).filter((n) => n.id !== tempId));
      setSendError(e instanceof Error ? e.message : 'Erreur réseau.');
    } finally {
      setSending(false);
    }
  }

  const list = notes ?? [];
  const visible = expanded ? list : list.slice(0, VISIBLE);

  return (
    <section className="bg-cream border border-sand-border rounded-modal p-4">
      <h2 className="fx-th inline-flex items-center gap-1.5 font-medium text-ink-mid mb-3">
        <Phone size={12} /> Notes d&apos;appel{notes ? ` (${list.length})` : ''}
      </h2>

      {/* Saisie */}
      <div className="space-y-2 mb-4">
        <textarea
          value={contenu}
          onChange={(e) => { setContenu(e.target.value); setSendError(null); }}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submit(); }
          }}
          rows={2}
          maxLength={2000}
          disabled={sending}
          placeholder="Note d'appel : qui a appelé, ce qui a été dit, ce qui est convenu…"
          className="fx-body w-full px-3 py-2.5 border border-sand-border rounded-lg bg-cream outline-none focus:border-navy-mid resize-y min-h-[56px] disabled:opacity-60"
        />
        <div className="flex flex-wrap items-center gap-2">
          {dossiers.length > 0 && (
            <select
              value={ivId}
              onChange={(e) => setIvId(e.target.value)}
              disabled={sending}
              aria-label="Rattacher à un dossier"
              className="fx-meta px-3 py-2 border border-sand-border rounded-lg bg-cream text-ink-mid outline-none focus:border-navy-mid cursor-pointer disabled:opacity-60"
            >
              <option value="">— Rattacher à un dossier (optionnel) —</option>
              {dossiers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.ref ?? d.id.slice(0, 8)} · {fmtDateShort(d.date)}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!contenu.trim() || sending}
            className="fx-label ml-auto px-3.5 py-2 rounded-lg font-semibold bg-navy text-cream hover:opacity-90 disabled:opacity-50"
          >
            {sending ? 'Enregistrement…' : 'Enregistrer la note'}
          </button>
        </div>
        {sendError && (
          <div className="fx-small px-3 py-1.5 bg-terra-light border border-terra-mid text-terra rounded-lg font-semibold">
            {sendError}
          </div>
        )}
      </div>

      {/* Liste */}
      {loadError ? (
        <div className="fx-small px-3 py-2 bg-terra-light border border-terra-mid text-terra rounded-lg font-semibold">
          {loadError}
        </div>
      ) : notes === null ? (
        <p className="fx-meta text-ink-mid italic">Chargement…</p>
      ) : list.length === 0 ? (
        <p className="fx-meta text-ink-mid italic">Aucune note d&apos;appel.</p>
      ) : (
        <>
          <ul className="divide-y divide-sand-mid">
            {visible.map((n) => (
              <li key={n.id} className="py-2.5">
                <div className="fx-small flex flex-wrap items-center gap-2 text-ink-mid">
                  <span className="tabular-nums font-semibold">{fmtDateTime(n.created_at)}</span>
                  {n.created_by && <span>— {n.created_by}</span>}
                  {n.intervention_ref && (
                    <span className="inline-block fx-ref font-semibold text-navy bg-navy-pale border border-navy-light rounded px-1.5 py-0.5">
                      {n.intervention_ref}
                    </span>
                  )}
                  {n.id.startsWith('temp-') && <span className="italic">envoi…</span>}
                </div>
                <p className="fx-body text-ink mt-1 whitespace-pre-wrap leading-relaxed">
                  {n.contenu}
                </p>
              </li>
            ))}
          </ul>
          {!expanded && list.length > VISIBLE && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="fx-small mt-1 w-full py-2 font-semibold text-navy hover:bg-sand-hover rounded-lg"
            >
              Voir plus ({list.length - VISIBLE} de plus)
            </button>
          )}
        </>
      )}
    </section>
  );
}
