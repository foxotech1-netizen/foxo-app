'use client';

import { useEffect, useRef } from 'react';

// Petite modale de confirmation réutilisable : titre + message + boutons
// Annuler / Confirmer. Verrouille le focus sur le bouton de confirmation
// à l'ouverture, ferme sur Escape, clic backdrop ou Annuler.
//
// Utilisée pour : suppression brouillon, remise en brouillon d'un envoyé,
// marquage accepté/refusé d'un devis. Garde un footprint minimal (pas de
// portail React, le dialog est rendu inline avec un backdrop fixed
// fullscreen à z-index très haut).
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  destructive = false,
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmBtnRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !pending) onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel, pending]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={() => { if (!pending) onCancel(); }}
      />
      <div className="relative bg-cream rounded-modal border border-sand-border shadow-overlay w-full max-w-md p-5 dark:bg-[#221E1A] dark:border-[#3D3A32]">
        <h2 id="confirm-dialog-title" className="fxs-section-title text-ink mb-2 dark:text-[#F0ECE4]">
          {title}
        </h2>
        <p className="text-[13px] text-ink-mid leading-relaxed dark:text-[#C8C2B8] whitespace-pre-line">
          {message}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="px-3.5 py-2 rounded-lg text-xs font-bold border border-sand-border bg-cream text-ink-mid hover:bg-sand-mid disabled:opacity-50 dark:bg-[#1C1A16] dark:text-[#C8C2B8] dark:border-[#3D3A32]"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={
              'px-3.5 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-50 ' +
              (destructive ? 'bg-terra hover:opacity-90' : 'bg-navy hover:opacity-90')
            }
          >
            {pending ? '…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
