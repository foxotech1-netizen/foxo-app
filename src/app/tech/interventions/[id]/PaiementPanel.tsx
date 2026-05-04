'use client';

import { useState } from 'react';
import { QrPaiement } from '@/components/QrPaiement';

type FactureLite = {
  id: string;
  numero: string;
  total_ttc: number;
  statut: string;
};

// Bouton "Paiement sur place" → POST /api/tech/facture qui retourne la
// facture liée (existante ou nouveau brouillon avec tarif paramétré).
// Affiche ensuite QrPaiement (QR EPC virement européen).
export function PaiementPanel({ interventionId }: { interventionId: string }) {
  const [loading, setLoading] = useState(false);
  const [facture, setFacture] = useState<FactureLite | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadFacture() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/tech/facture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intervention_id: interventionId }),
      });
      const data = await r.json();
      if (!data.ok) {
        setError(data.error ?? 'Erreur facture.');
        return;
      }
      setFacture(data.facture as FactureLite);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur réseau.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="bg-cream border border-sand-border rounded-2xl p-4">
      <div className="text-[10px] font-bold text-ink-muted uppercase tracking-widest mb-2">
        Paiement sur place
      </div>

      {!facture && (
        <button
          type="button"
          onClick={loadFacture}
          disabled={loading}
          className="w-full bg-navy text-white px-4 py-3 rounded-md text-[13px] font-bold hover:bg-navy-mid disabled:opacity-60 disabled:cursor-wait transition"
        >
          {loading ? 'Génération en cours…' : '💳 Paiement sur place'}
        </button>
      )}

      {error && (
        <div className="mt-2 text-xs text-terra bg-terra-light border border-terra-mid rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {facture && (
        <div className="mt-2">
          <QrPaiement
            factureId={facture.id}
            numero={facture.numero}
            montantTTC={facture.total_ttc}
          />
        </div>
      )}
    </section>
  );
}
