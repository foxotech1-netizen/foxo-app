'use client';

// Aperçu rapide d'un document de facturation depuis les listes : grande
// modale (fermable Échap / clic dehors) qui embarque le PDF via la route
// existante /api/admin/facture/[id] (servie en Content-Disposition inline —
// embarquable telle quelle, aucun nouveau générateur).

import { useEffect } from 'react';
import Link from 'next/link';
import { X, ExternalLink, Download } from 'lucide-react';

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
  /** URL du PDF (route existante, inline). */
  pdfUrl: string;
  /** Chemin de la fiche détail (« Ouvrir la fiche »). */
  fichePath: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

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
        <iframe
          src={pdfUrl}
          title={`PDF ${title}`}
          className="flex-1 w-full bg-white"
        />
      </div>
    </div>
  );
}
