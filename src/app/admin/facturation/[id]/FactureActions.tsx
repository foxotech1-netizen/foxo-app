'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RowMenu } from '@/components/RowMenu';
import { setFactureStatut, deleteFacture } from '../actions';
import type { Facture } from '@/lib/types/database';

export function FactureActions({ facture }: { facture: Facture }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function call(fn: () => Promise<{ ok: boolean; error?: string } | { ok: true } | { ok: false; error: string }>, okMsg?: string) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok && 'error' in res) {
        alert(res.error);
        return;
      }
      if (okMsg) alert(okMsg);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <a
        href={`/api/admin/facture/${facture.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="bg-navy text-white px-3 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 min-h-[44px] inline-flex items-center"
      >
        📄 PDF
      </a>
      <RowMenu
        ariaLabel="Actions facture"
        items={[
          {
            icon: '✉️',
            label: 'Marquer envoyée',
            onClick: () => call(() => setFactureStatut(facture.id, 'envoyee')),
            hidden: facture.statut !== 'brouillon',
            disabled: pending,
          },
          {
            icon: '✅',
            label: 'Marquer payée',
            onClick: () => call(() => setFactureStatut(facture.id, 'payee')),
            hidden: facture.statut === 'payee' || facture.statut === 'annulee',
            disabled: pending,
          },
          {
            icon: '↩',
            label: 'Repasser en brouillon',
            onClick: () => call(() => setFactureStatut(facture.id, 'brouillon')),
            hidden: facture.statut === 'brouillon' || facture.statut === 'payee',
            disabled: pending,
          },
          {
            icon: '🗑️',
            label: facture.statut === 'brouillon' ? 'Supprimer' : 'Annuler la facture',
            destructive: true,
            disabled: pending,
            onClick: () => {
              const isDraft = facture.statut === 'brouillon';
              const msg = isDraft
                ? `Supprimer définitivement le brouillon ${facture.numero} ?`
                : `Annuler la facture ${facture.numero} ?`;
              if (!confirm(msg)) return;
              call(() => deleteFacture(facture.id), isDraft ? 'Brouillon supprimé.' : 'Facture annulée.');
            },
          },
        ]}
      />
    </div>
  );
}
