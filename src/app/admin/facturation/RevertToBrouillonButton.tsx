'use client';

// Bouton « Remettre en brouillon » des pages détail (facture, devis, note
// de crédit). Visible uniquement pour les statuts éligibles (envoyée /
// en retard) — le numéro définitif et la BBA sont conservés.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Undo2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { revertToBrouillon } from './actions';
import type { Facture } from '@/lib/types/database';

export function RevertToBrouillonButton({ facture }: { facture: Facture }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (facture.statut !== 'envoyee' && facture.statut !== 'en_retard') return null;

  function handleConfirm() {
    startTransition(async () => {
      const res = await revertToBrouillon(facture.id);
      setConfirmOpen(false);
      if (!res.ok) {
        alert(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        disabled={pending}
        className="bg-white text-ink-mid border border-sand-border px-3 py-2 rounded-lg text-[12px] font-bold hover:bg-sand-hover disabled:opacity-50 min-h-[44px] inline-flex items-center gap-1.5"
      >
        <Undo2 size={14} aria-hidden /> Remettre en brouillon
      </button>
      <ConfirmDialog
        open={confirmOpen}
        title={`Remettre ${facture.numero} en brouillon ?`}
        message={`La pièce redevient modifiable et CONSERVE son numéro ${facture.numero}. Si elle a déjà été transmise au client, préférez une note de crédit.`}
        confirmLabel="Remettre en brouillon"
        pending={pending}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
