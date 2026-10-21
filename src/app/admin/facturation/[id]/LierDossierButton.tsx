'use client';

// « Lier à un dossier » — action rapide du détail facture, disponible à
// TOUT statut. Modale avec l'autocomplete /api/admin/interventions/search ;
// ne modifie QUE intervention_id (setFactureIntervention). Sert à rattacher
// l'historique importé d'Odoo aux dossiers au fil de leur encodage.

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Link2, X } from 'lucide-react';
import { setFactureIntervention } from '../actions';

interface DossierResult { id: string; ref: string | null; adresse: string | null }

export function LierDossierButton({
  factureId,
  interventionId,
  interventionRef,
}: {
  factureId: string;
  interventionId: string | null;
  interventionRef: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DossierResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/interventions/search?q=${encodeURIComponent(q)}`);
        const json = (await res.json()) as { success: boolean; results?: DossierResult[] };
        if (json.success) setResults(json.results ?? []);
      } catch { /* réseau : liste précédente conservée */ }
    }, 280);
    return () => clearTimeout(t);
  }, [query, open]);

  function apply(newInterventionId: string | null) {
    setError(null);
    startTransition(async () => {
      const res = await setFactureIntervention(factureId, newInterventionId);
      if (!res.ok) { setError(res.error); return; }
      setOpen(false);
      setQuery('');
      setResults([]);
      router.refresh();
    });
  }

  const showResults = query.trim().length >= 2 && results.length > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setError(null); }}
        title={interventionRef
          ? `Liée au dossier ${interventionRef} — cliquer pour changer.`
          : 'Rattacher cette facture à un dossier (rentabilité par dossier).'}
        className="fx-label bg-cream text-ink-mid border border-sand-border px-3 py-2 rounded-lg font-semibold hover:bg-sand-hover min-h-[44px] inline-flex items-center gap-1.5"
      >
        <Link2 size={14} aria-hidden />
        {interventionRef ? (
          <>Dossier <span className="fx-ref text-navy">{interventionRef}</span></>
        ) : ( 'Lier à un dossier'
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Lier la facture à un dossier"
        >
          <div
            className="bg-cream rounded-modal border border-sand-border p-5 w-full max-w-[440px] space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="fx-h3 font-semibold text-ink">Lier à un dossier</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-ink-mid hover:text-ink p-1"
                aria-label="Fermer"
              >
                <X size={16} aria-hidden />
              </button>
            </div>

            {interventionId && (
              <div className="fx-meta flex items-center justify-between gap-2 bg-navy-pale border border-navy-light rounded-lg px-3 py-2">
                <span>
                  Actuellement liée à <span className="fx-ref font-semibold text-navy">{interventionRef ?? interventionId.slice(0, 8)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => apply(null)}
                  disabled={pending}
                  className="fx-small font-semibold text-terra hover:underline disabled:opacity-50"
                >
                  Délier
                </button>
              </div>
            )}

            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ex : 2026-012 ou Rue Willems…"
              autoFocus
              className="fx-body w-full px-3 py-2.5 border border-sand-border rounded-lg bg-cream outline-none focus:border-navy-mid"
            />
            {showResults && (
              <div className="bg-cream border border-sand-border rounded-lg divide-y divide-sand-mid max-h-[240px] overflow-y-auto">
                {results.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => apply(r.id)}
                    disabled={pending}
                    className="fx-meta block w-full text-left px-3 py-2 hover:bg-sand disabled:opacity-50"
                  >
                    <span className="fx-ref font-semibold text-navy">{r.ref ?? '—'}</span>
                    <span className="text-ink-mid"> — {r.adresse ?? ''}</span>
                  </button>
                ))}
              </div>
            )}
            {query.trim().length >= 2 && results.length === 0 && (
              <p className="fx-small text-ink-mid italic">Aucun dossier trouvé.</p>
            )}

            {error && (
              <div className="fx-label text-terra bg-terra-light border border-terra-mid rounded-lg px-3 py-2 font-semibold">
                {error}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
