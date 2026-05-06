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
    ? <span className="inline-flex items-center gap-1"><Save size={10} />Sauvegarde…</span>
    : error
      ? <span className="inline-flex items-center gap-1"><AlertTriangle size={10} />{error} (sauvegardé localement)</span>
      : dirty
        ? '… modifications en attente'
        : savedAt
          ? <span className="inline-flex items-center gap-1"><Check size={10} />Sauvegardé {new Date(savedAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}</span>
          : initial
            ? <span className="inline-flex items-center gap-1"><Check size={10} />Synchronisé</span>
            : '';

  return (
    <section className="bg-cream border border-sand-border rounded-2xl p-4 dark:bg-[#1C1A16] dark:border-[#2C2A24]">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-bold text-ink-muted uppercase tracking-widest dark:text-[#C8C2B8] inline-flex items-center gap-1.5">
          <MessageCircle size={12} />Notes technicien
        </div>
        <span className={
          'text-[10px] font-semibold ' +
          (error ? 'text-terra' : pendingSync ? 'text-navy dark:text-[#A8C4F2]' : 'text-ok dark:text-[#7AC9A0]')
        }>
          {status}
        </span>
      </div>
      <textarea
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Notes internes (digicode, accès difficile, prochaine inspection…). Non visibles par le client."
        rows={5}
        className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid resize-y dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
      />
      <p className="text-[10px] text-ink-muted mt-2 italic dark:text-[#C8C2B8]">
        Sauvegarde automatique 2s après la dernière frappe. Persistance locale en cas de coupure réseau.
      </p>
    </section>
  );
}
