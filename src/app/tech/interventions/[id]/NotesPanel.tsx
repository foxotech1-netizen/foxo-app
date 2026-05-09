'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, MessageCircle, Save } from 'lucide-react';

const STORE_KEY = (id: string) => `foxo_tech_notes_${id}`;

// Auto-save debounced 2s. Si la requête échoue (offline ou serveur),
// on persiste localement dans localStorage et on retente au prochain
// changement de connectivité. Le contenu local prévaut sur le serveur
// si on en a un (le tech vient de taper, le serveur est la version
// précédente).
export function NotesPanel({
  interventionId,
  initial,
}: {
  interventionId: string;
  initial: string | null;
}) {
  const [text, setText] = useState<string>(() => {
    if (typeof window === 'undefined') return initial ?? '';
    try {
      const local = window.localStorage.getItem(STORE_KEY(interventionId));
      if (local !== null) return local;
    } catch { /* noop */ }
    return initial ?? '';
  });
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [pendingSync, setPendingSync] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastSentRef = useRef<string>(initial ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function persist(newText: string) {
    if (newText === lastSentRef.current) return;
    setPendingSync(true);
    setError(null);
    try {
      const r = await fetch(`/api/tech/interventions/${interventionId}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes_tech: newText }),
      });
      const data = await r.json();
      if (!data.ok) {
        setError(data.error ?? 'Erreur sauvegarde.');
        return;
      }
      lastSentRef.current = newText;
      setSavedAt(data.saved_at ?? new Date().toISOString());
      // Cleanup local copy une fois synchro
      try { window.localStorage.removeItem(STORE_KEY(interventionId)); } catch { /* noop */ }
    } catch (e) {
      // Hors ligne — garde la copie locale, retente au retour réseau
      setError(e instanceof Error ? e.message : 'Erreur réseau.');
    } finally {
      setPendingSync(false);
    }
  }

  function handleChange(v: string) {
    setText(v);
    // Persist local immédiatement (mode offline-first)
    try { window.localStorage.setItem(STORE_KEY(interventionId), v); } catch { /* noop */ }
    // Debounce serveur 2s
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => persist(v), 2000);
  }

  // Retente la sync au retour de la connectivité
  useEffect(() => {
    function onOnline() {
      const local = (() => {
        try { return window.localStorage.getItem(STORE_KEY(interventionId)); } catch { return null; }
      })();
      if (local !== null && local !== lastSentRef.current) {
        persist(local);
      }
    }
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interventionId]);

  // Flush au unmount (au cas où l'utilisateur quitte la page rapidement)
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (text !== lastSentRef.current) {
        // Best-effort sync avant unmount — fetch keepalive permet de
        // continuer la requête même après navigation.
        try {
          fetch(`/api/tech/interventions/${interventionId}/notes`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes_tech: text }),
            keepalive: true,
          });
        } catch { /* noop */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interventionId]);

  const dirty = text !== lastSentRef.current;
  const status: React.ReactNode = pendingSync
    ? <span className="inline-flex items-center gap-1"><Save size={11} />Sauvegarde…</span>
    : error
      ? <span className="inline-flex items-center gap-1"><AlertTriangle size={11} />{error} (sauvegardé localement)</span>
      : dirty
        ? '… modifications en attente'
        : savedAt
          ? <span className="inline-flex items-center gap-1"><Check size={11} />Sauvegardé {new Date(savedAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}</span>
          : initial
            ? <span className="inline-flex items-center gap-1"><Check size={11} />Synchronisé</span>
            : '';

  return (
    <section
      className="bg-[var(--color-cream)] rounded-xl p-4"
      style={{ boxShadow: '0 1px 2px rgba(15,32,64,0.04), 0 4px 12px rgba(15,32,64,0.05), 0 0 0 1px rgba(15,32,64,0.04)' }}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2.5">
          <span className="w-[3px] h-3.5 rounded-sm bg-[var(--accent-tech)]"></span>
          <div className="font-sora text-[11px] font-medium text-[var(--color-ink-mid)] uppercase tracking-[0.12em] inline-flex items-center gap-1.5">
            <MessageCircle size={13} />Notes technicien
          </div>
        </div>
        <span className={
          'text-[11px] font-semibold ' +
          (error ? 'text-[var(--color-terra)]' : pendingSync ? 'text-[var(--color-navy)]' : 'text-[var(--color-ok)]')
        }>
          {status}
        </span>
      </div>
      <textarea
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Notes internes (digicode, accès difficile, prochaine inspection…). Non visibles par le client."
        rows={5}
        className="w-full px-3.5 py-3 border border-[var(--color-sand-border)] rounded-lg text-[14px] bg-[var(--color-cream)] text-[var(--color-ink)] outline-none focus:border-[var(--accent-tech)] resize-y"
      />
      <p className="text-[12px] text-[var(--color-ink-mid)] mt-2 italic">
        Sauvegarde automatique 2s après la dernière frappe. Persistance locale en cas de coupure réseau.
      </p>
    </section>
  );
}
