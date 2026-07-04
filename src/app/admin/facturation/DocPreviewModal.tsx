'use client';

// Aperçu rapide d'un document de facturation depuis les listes : grande
// modale (fermable Échap / clic dehors) qui embarque le PDF de la route
// existante /api/admin/facture/[id].
//
// Le site pose X-Frame-Options: DENY globalement (next.config.ts) — même en
// same-origin, une iframe pointant directement sur la route est bloquée.
// Contournement PROPRE sans toucher aux en-têtes de sécurité : on fetch le
// PDF côté client → blob → URL.createObjectURL comme src de l'iframe (un
// blob: URL ne porte pas les en-têtes anti-framing de la réponse d'origine).
// L'ObjectURL est révoqué à la fermeture.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X, ExternalLink, Download, Loader2 } from 'lucide-react';

export function DocPreviewModal({
  open,
  onClose,
  title,
  pdfUrl,
  fichePath,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** URL du PDF (route existante). */
  pdfUrl: string;
  /** Chemin de la fiche détail (« Ouvrir la fiche »). */
  fichePath: string;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Fetch → blob à l'ouverture ; révocation de l'ObjectURL à la fermeture.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let url: string | null = null;
    setLoading(true);
    setError(null);
    setBlobUrl(null);
    (async () => {
      try {
        const res = await fetch(pdfUrl);
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(j?.error ?? `HTTP ${res.status}`);
        }
        const blob = await res.blob();
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setBlobUrl(url);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Erreur de chargement du PDF.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [open, pdfUrl]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Aperçu ${title}`}
    >
      <div
        className="bg-cream rounded-2xl border border-sand-border w-full max-w-[860px] h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-sand-border flex-shrink-0">
          <div className="text-[13px] font-bold text-ink truncate">{title}</div>
          <div className="flex items-center gap-2">
            <Link
              href={fichePath}
              className="bg-navy text-white px-3 py-1.5 rounded-lg text-[11px] font-bold hover:opacity-90 inline-flex items-center gap-1"
            >
              <ExternalLink size={12} aria-hidden /> Ouvrir la fiche
            </Link>
            <a
              href={pdfUrl}
              download
              className="bg-white text-navy border border-navy-light px-3 py-1.5 rounded-lg text-[11px] font-bold hover:bg-navy-pale inline-flex items-center gap-1"
            >
              <Download size={12} aria-hidden /> Télécharger
            </a>
            <button
              type="button"
              onClick={onClose}
              className="text-ink-muted hover:text-ink p-1"
              aria-label="Fermer"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
        </header>
        {loading && (
          <div className="flex-1 flex items-center justify-center gap-2 text-[13px] text-ink-mid font-semibold">
            <Loader2 size={16} className="animate-spin" aria-hidden /> Chargement du PDF…
          </div>
        )}
        {!loading && error && (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="text-center space-y-2 max-w-[420px]">
              <p className="text-[13px] font-bold text-terra">
                Impossible d&apos;afficher l&apos;aperçu.
              </p>
              <p className="text-[12px] text-ink-mid">{error}</p>
              <p className="text-[12px] text-ink-muted">
                Utilise « Ouvrir la fiche » ou « Télécharger » ci-dessus.
              </p>
            </div>
          </div>
        )}
        {!loading && !error && blobUrl && (
          <iframe
            src={blobUrl}
            title={`PDF ${title}`}
            className="flex-1 w-full bg-white"
          />
        )}
      </div>
    </div>
  );
}
