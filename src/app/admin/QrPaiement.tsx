'use client';

// QR de paiement (virement SEPA, format EPC) d'un brouillon Odoo créé depuis
// FoxO : le client le scanne sur place avec son application bancaire ;
// montant, IBAN et communication structurée sont pré-remplis. L'image est
// produite côté serveur (odoo-brouillon.ts → epc-qr.ts).

import type { PaiementBrouillon } from '@/lib/facturation/odoo-brouillon';

function fmtMontant(n: number): string {
  return n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

export function QrPaiement({ paiement }: { paiement: PaiementBrouillon }) {
  return (
    <div className="mt-3 p-3 rounded-lg border border-sand-border bg-white flex flex-wrap items-center gap-4" data-testid="odoo-qr-paiement">
      {/* eslint-disable-next-line @next/next/no-img-element -- image générée (data URL), pas un asset optimisable */}
      <img
        src={paiement.qr_data_url}
        alt={`QR de paiement : ${fmtMontant(paiement.montant_ttc)}, communication ${paiement.communication}`}
        width={176}
        height={176}
        className="w-44 h-44 shrink-0 rounded"
      />
      <div className="text-[13px] space-y-1 min-w-0">
        <div className="font-semibold">Paiement sur place</div>
        <div className="text-ink-mid">Le client scanne ce code avec son application bancaire.</div>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 pt-1">
          <span className="text-ink-mid">Montant</span><span className="font-semibold tabular-nums">{fmtMontant(paiement.montant_ttc)}</span>
          <span className="text-ink-mid">IBAN</span><span className="font-mono">{paiement.iban}</span>
          <span className="text-ink-mid">Bénéficiaire</span><span>{paiement.beneficiaire}</span>
          <span className="text-ink-mid">Communication</span><span className="font-mono">{paiement.communication}</span>
        </div>
      </div>
    </div>
  );
}
