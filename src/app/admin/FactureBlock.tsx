'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { FactureItem } from '@/lib/pdf/FacturePdf';
import { computeTotals } from '@/lib/pdf/FacturePdf';
import { emitFacture } from './actions';
import type { StatutIntervention } from '@/lib/types/database';

const DEFAULT_VAT_RATE = 21;

function fmt(n: number): string {
  return n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function FactureBlock({
  interventionId,
  ref,
  statut,
}: {
  interventionId: string;
  ref: string | null;
  statut: StatutIntervention;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const facturee = statut === 'facturee' || statut === 'cloturee';
  const [editing, setEditing] = useState(!facturee);

  const [items, setItems] = useState<FactureItem[]>([
    {
      description: `Détection de fuites — Intervention ${ref ?? ''}`.trim(),
      quantity: 1,
      unitPrice: 0,
    },
  ]);
  const [vatRate, setVatRate] = useState(DEFAULT_VAT_RATE);
  const [notes, setNotes] = useState('');

  const totals = useMemo(() => computeTotals(items, vatRate), [items, vatRate]);

  function addItem() {
    setItems((arr) => [...arr, { description: '', quantity: 1, unitPrice: 0 }]);
  }
  function removeItem(i: number) {
    setItems((arr) => (arr.length > 1 ? arr.filter((_, idx) => idx !== i) : arr));
  }
  function updateItem(i: number, patch: Partial<FactureItem>) {
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  function emit() {
    setFeedback(null);
    if (items.some((it) => it.unitPrice <= 0)) {
      setFeedback({ kind: 'err', msg: 'Tous les prix unitaires doivent être > 0.' });
      return;
    }
    startTransition(async () => {
      const res = await emitFacture({ interventionId, items, vatRate, notes });
      if ('error' in res && res.error) {
        setFeedback({ kind: 'err', msg: res.error });
        return;
      }
      if ('ok' in res && res.ok) {
        setFeedback({
          kind: 'ok',
          msg: `Facture ${res.data.numero} émise (${fmt(res.data.montantTTC)} € TTC).`,
        });
        setEditing(false);
        router.refresh();
      }
    });
  }

  if (!editing && facturee) {
    return (
      <div className="bg-cream rounded-xl px-3.5 py-3 border border-sand-border">
        <div className="text-[10px] font-bold text-ink-muted uppercase tracking-wider mb-2">
          Facturation
        </div>
        <div className="text-[13px] text-ok font-semibold">✓ Facture émise</div>
        <p className="text-[11px] text-ink-muted mt-1">
          PDF stocké dans le bucket <span className="font-mono">invoices/{interventionId}.pdf</span>
        </p>
        {feedback?.kind === 'ok' && (
          <p className="text-xs mt-2 text-ok font-semibold">{feedback.msg}</p>
        )}
        <button
          onClick={() => { setEditing(true); setFeedback(null); }}
          className="mt-3 bg-[#A17244] text-white px-3 py-1.5 rounded-md text-[11px] font-semibold hover:bg-[#8A613B]"
        >
          Ré-émettre / corriger
        </button>
      </div>
    );
  }

  return (
    <div className="bg-cream rounded-xl px-3.5 py-3 border border-sand-border">
      <div className="text-[10px] font-bold text-ink-muted uppercase tracking-wider mb-2">
        {facturee ? 'Ré-émission de la facture' : 'Émettre la facture'}
      </div>

      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="bg-sand rounded-lg p-2.5 border border-sand-border">
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <span className="text-[10px] font-bold text-ink-muted uppercase tracking-wider">
                Ligne {i + 1}
              </span>
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeItem(i)}
                  className="text-[11px] text-terra hover:underline"
                >
                  Retirer
                </button>
              )}
            </div>
            <textarea
              value={it.description}
              onChange={(e) => updateItem(i, { description: e.target.value })}
              placeholder="Description de la prestation"
              rows={2}
              className="w-full px-2.5 py-1.5 border border-sand-border rounded text-[12px] bg-white outline-none focus:border-navy-mid resize-y mb-1.5"
            />
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] text-ink-muted">
                Qté
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={it.quantity}
                  onChange={(e) => updateItem(i, { quantity: parseFloat(e.target.value) || 0 })}
                  className="w-full mt-0.5 px-2 py-1.5 border border-sand-border rounded text-[12px] bg-white outline-none focus:border-navy-mid"
                />
              </label>
              <label className="text-[10px] text-ink-muted">
                P.U. HT (€)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={it.unitPrice}
                  onChange={(e) => updateItem(i, { unitPrice: parseFloat(e.target.value) || 0 })}
                  className="w-full mt-0.5 px-2 py-1.5 border border-sand-border rounded text-[12px] bg-white outline-none focus:border-navy-mid"
                />
              </label>
            </div>
            <div className="text-right text-[11px] text-ink-mid mt-1.5 font-mono">
              Sous-total HT : {fmt(it.quantity * it.unitPrice)} €
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addItem}
        className="mt-2 bg-sand-mid text-ink-mid px-3 py-1.5 rounded-md text-[11px] font-semibold"
      >
        + Ajouter une ligne
      </button>

      <div className="grid grid-cols-2 gap-2 mt-3">
        <label className="text-[10px] text-ink-muted">
          TVA (%)
          <input
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={vatRate}
            onChange={(e) => setVatRate(parseFloat(e.target.value) || 0)}
            className="w-full mt-0.5 px-2 py-1.5 border border-sand-border rounded text-[12px] bg-white outline-none focus:border-navy-mid"
          />
        </label>
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes / mentions complémentaires (optionnel)"
        rows={2}
        className="w-full mt-2 px-2.5 py-1.5 border border-sand-border rounded text-[12px] bg-white outline-none focus:border-navy-mid resize-y"
      />

      {/* Récap totaux */}
      <div className="mt-3 bg-sand rounded-lg p-2.5 border border-sand-border space-y-1 font-mono">
        <Row label="Total HT" value={`${fmt(totals.ht)} €`} />
        <Row label={`TVA ${vatRate}%`} value={`${fmt(totals.tva)} €`} />
        <Row label="Total TTC" value={`${fmt(totals.ttc)} €`} bold />
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3">
        {facturee && (
          <button
            type="button"
            onClick={() => { setEditing(false); setFeedback(null); }}
            disabled={pending}
            className="bg-sand-mid text-ink-mid py-2.5 rounded-lg text-xs font-bold disabled:opacity-50"
          >
            Annuler
          </button>
        )}
        <button
          type="button"
          onClick={emit}
          disabled={pending}
          className={
            (facturee ? '' : 'col-span-2 ') +
            'bg-navy text-white py-2.5 rounded-lg text-xs font-bold disabled:opacity-50'
          }
        >
          {pending ? 'Génération…' : facturee ? '✓ Confirmer la ré-émission' : '✓ Émettre la facture'}
        </button>
      </div>

      {feedback && (
        <p className={
          'text-xs mt-2 font-semibold ' +
          (feedback.kind === 'ok' ? 'text-ok' : 'text-terra')
        }>
          {feedback.msg}
        </p>
      )}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between items-center text-[12px]">
      <span className={bold ? 'font-bold text-navy' : 'text-ink-mid'}>{label}</span>
      <span className={bold ? 'font-bold text-navy text-[13px]' : 'text-ink'}>{value}</span>
    </div>
  );
}
