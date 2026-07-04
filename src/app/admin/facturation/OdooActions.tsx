'use client';

// Bouton « Pousser vers Odoo » + badge « Odoo ✓ » — partagé entre le détail
// facture, le détail note de crédit et le détail facture d'achat.
// `odooEnabled` est calculé côté serveur (isOdooEnabled) — aucun secret ici.

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { UploadCloud, CheckCircle2 } from 'lucide-react';
import { pushFactureVersOdoo } from './actions';
import { pushAchatVersOdoo } from './achats/actions';

export function OdooActions({
  id,
  kind,
  label,
  odooMoveId,
  odooPushedAt,
  odooEnabled,
  pushable,
  disabledReason,
}: {
  id: string;
  kind: 'vente' | 'achat';
  /** Libellé de la pièce dans la confirmation (ex. numéro). */
  label: string;
  odooMoveId: string | null;
  odooPushedAt: string | null;
  odooEnabled: boolean;
  /** La pièce est-elle dans un état poussable (émise / validée) ? */
  pushable: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (odooMoveId) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-md bg-ok-light border border-ok-mid text-ok"
        title={`Move Odoo ${odooMoveId}${odooPushedAt ? ` — poussé le ${new Date(odooPushedAt).toLocaleString('fr-BE')}` : ''}`}
      >
        <CheckCircle2 size={12} aria-hidden /> Odoo ✓
        {odooPushedAt && (
          <span className="font-normal">
            {new Date(odooPushedAt).toLocaleDateString('fr-BE')}
          </span>
        )}
      </span>
    );
  }

  const enabled = odooEnabled && pushable;

  function handlePush() {
    if (!confirm(`Pousser ${label} vers Odoo (account.move) ?`)) return;
    startTransition(async () => {
      const res = kind === 'achat'
        ? await pushAchatVersOdoo(id)
        : await pushFactureVersOdoo(id);
      if (!res.ok) alert(res.error);
      else alert(`Poussé vers Odoo (move ${res.data!.moveId}).`);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={enabled ? handlePush : undefined}
      disabled={!enabled || pending}
      title={
        !odooEnabled
          ? 'Odoo non activé — configurez la synchronisation dans Paramètres (clés serveur + interrupteur).'
          : !pushable
            ? (disabledReason ?? 'Pièce non poussable dans cet état.')
            : 'Crée l\'écriture account.move dans Odoo (analytique par dossier).'
      }
      className={
        'px-3 py-2 rounded-lg text-[12px] font-bold min-h-[44px] inline-flex items-center gap-1.5 ' +
        (enabled
          ? 'bg-white text-navy border border-navy-light hover:bg-navy-pale disabled:opacity-50'
          : 'bg-sand-mid text-ink-muted border border-sand-border cursor-not-allowed')
      }
    >
      <UploadCloud size={14} aria-hidden /> {pending ? 'Envoi…' : 'Pousser vers Odoo'}
    </button>
  );
}
