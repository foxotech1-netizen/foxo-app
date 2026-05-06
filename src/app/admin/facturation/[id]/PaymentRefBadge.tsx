'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

// Affiche la communication structurée BBA (reference_structuree) avec
// un bouton copier — le tech / l'admin colle ça dans son virement bancaire.
// Si la facture n'a pas encore été émise (pas de BBA générée), affiche '—'.
export function PaymentRefBadge({ reference }: { reference: string | null }) {
  const [copied, setCopied] = useState(false);

  if (!reference || !reference.trim()) {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-sand-mid border border-sand-border rounded-md text-[11px] text-ink-muted">
        <span className="font-bold uppercase tracking-wider text-[9px]">Réf. paiement</span>
        <span className="font-mono">—</span>
      </div>
    );
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(reference!);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* noop : clipboard non dispo (Safari private, http non sécurisé…) */
    }
  }

  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-navy-pale border border-navy-light rounded-md text-[11px]">
      <span className="text-ink-muted font-bold uppercase tracking-wider text-[9px]">Réf. paiement</span>
      <span className="font-mono font-bold text-navy">{reference}</span>
      <button
        type="button"
        onClick={copy}
        className="ml-1 p-1 rounded hover:bg-navy/10 transition-colors"
        title={copied ? 'Copié' : 'Copier la référence'}
        aria-label="Copier la référence de paiement"
      >
        {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
      </button>
    </div>
  );
}
