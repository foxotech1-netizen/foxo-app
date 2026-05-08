'use client';

import { useEffect, useState } from 'react';
import { Check, CreditCard, Minus, Plus } from 'lucide-react';
import { QrPaiement } from '@/components/QrPaiement';

type FactureLite = {
  id: string;
  numero: string;
  total_ttc: number;
  statut: string;
};

type CatalogArticle = {
  id: string;
  code: string | null;
  description: string;
  prix_htva: number;
  tva_pct: number;
};

function fmtMoney(n: number): string {
  return n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

// Bouton "Paiement sur place" en 3 états :
//   A) sélection — catalogue d'articles + +/- quantité (state initial)
//   B) loading   — POST /api/tech/facture en cours
//   C) facture   — QrPaiement + form référence client (PATCH inline)
export function PaiementPanel({ interventionId }: { interventionId: string }) {
  const [catalog, setCatalog] = useState<CatalogArticle[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(false);
  const [facture, setFacture] = useState<FactureLite | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Référence client (form inline post-création)
  const [refValue, setRefValue] = useState('');
  const [refSaving, setRefSaving] = useState(false);
  const [refSaved, setRefSaved] = useState(false);
  const [refError, setRefError] = useState<string | null>(null);

  // Charge le catalogue actif au mount.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/tech/articles')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (!data.ok) {
          setCatalogError(data.error ?? 'Catalogue indisponible.');
          setCatalog([]);
          return;
        }
        setCatalog(data.articles as CatalogArticle[]);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setCatalogError(e instanceof Error ? e.message : 'Erreur réseau.');
        setCatalog([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function setQty(id: string, qty: number) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (qty <= 0) next.delete(id);
      else next.set(id, qty);
      return next;
    });
  }

  function increment(id: string) {
    const cur = selected.get(id) ?? 0;
    setQty(id, cur + 1);
  }

  function decrement(id: string) {
    const cur = selected.get(id) ?? 0;
    setQty(id, Math.max(0, cur - 1));
  }

  async function generateFacture(withArticles: boolean) {
    setLoading(true);
    setError(null);
    try {
      const articles = withArticles && catalog
        ? Array.from(selected.entries()).map(([id, quantite]) => {
            const a = catalog.find((c) => c.id === id);
            if (!a) return null;
            return {
              id: a.id,
              description: a.description,
              prix_htva: a.prix_htva,
              tva_pct: a.tva_pct,
              quantite,
              code: a.code,
            };
          }).filter((x): x is NonNullable<typeof x> => x !== null)
        : undefined;
      const r = await fetch('/api/tech/facture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intervention_id: interventionId, articles }),
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

  async function saveRef() {
    if (!facture) return;
    setRefSaving(true);
    setRefError(null);
    setRefSaved(false);
    try {
      const r = await fetch(`/api/tech/facture/${facture.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref_bon_commande: refValue }),
      });
      const data = await r.json();
      if (!data.ok) {
        setRefError(data.error ?? 'Erreur sauvegarde.');
        return;
      }
      setRefSaved(true);
      setTimeout(() => setRefSaved(false), 2000);
    } catch (e) {
      setRefError(e instanceof Error ? e.message : 'Erreur réseau.');
    } finally {
      setRefSaving(false);
    }
  }

  // ─── STATE C : facture générée ────────────────────────────────────
  if (facture) {
    return (
      <section className="premium-card">
        <div className="section-label mb-2">Paiement sur place</div>
        <QrPaiement
          factureId={facture.id}
          numero={facture.numero}
          montantTTC={facture.total_ttc}
        />
        <div className="mt-4 pt-4 border-t border-sand-border">
          <label className="section-label block mb-1.5">
            Référence client (optionnel)
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={refValue}
              onChange={(e) => setRefValue(e.target.value)}
              placeholder="ex: BC-2024-001"
              className="flex-1 px-3 py-2 border border-sand-border rounded-md text-[13px] bg-white outline-none focus:border-navy-mid"
              maxLength={100}
            />
            <button
              type="button"
              onClick={saveRef}
              disabled={refSaving}
              className="bg-navy text-white px-3 py-2 rounded-md text-[12px] font-bold transition-opacity hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {refSaved ? (
                <><Check size={14} />Enregistré</>
              ) : refSaving ? 'Sauvegarde…' : 'Enregistrer la réf.'}
            </button>
          </div>
          {refError && (
            <div className="mt-1 text-[11px] text-terra">{refError}</div>
          )}
        </div>
      </section>
    );
  }

  // ─── Catalogue en cours de chargement ─────────────────────────────
  if (catalog === null) {
    return (
      <section className="premium-card">
        <div className="section-label mb-2">Paiement sur place</div>
        <div className="text-[12px] text-ink-muted">Chargement du catalogue…</div>
      </section>
    );
  }

  // ─── STATE A : sélection articles ─────────────────────────────────
  const totalSelected = Array.from(selected.values()).reduce((s, q) => s + q, 0);

  return (
    <section className="premium-card">
      <div className="section-label mb-3">Paiement sur place</div>

      {catalogError && (
        <div className="mb-2 text-[11px] text-terra bg-terra-light border border-terra-mid rounded-md px-3 py-2">
          {catalogError}
        </div>
      )}

      {catalog.length === 0 && !catalogError && (
        <div className="text-[12px] text-ink-muted italic mb-3">
          Aucun article au catalogue. Utilise « Passer sans article ».
        </div>
      )}

      {catalog.length > 0 && (
        <div className="grid gap-2 mb-3">
          {catalog.map((a) => {
            const qty = selected.get(a.id) ?? 0;
            const ttc = a.prix_htva * (1 + a.tva_pct / 100);
            const isSelected = qty > 0;
            return (
              <div
                key={a.id}
                className={
                  'border-2 rounded-lg p-3 transition ' +
                  (isSelected ? 'border-ok' : 'border-sand-border bg-white')
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-navy">{a.description}</div>
                    <div className="text-[11px] text-ink-muted mt-0.5">
                      {fmtMoney(ttc)} TTC
                      {a.code && <span className="ml-2 font-mono">[{a.code}]</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => decrement(a.id)}
                      disabled={qty === 0}
                      className="w-7 h-7 rounded-md bg-sand-mid text-navy flex items-center justify-center disabled:opacity-30 transition-opacity hover:opacity-80"
                      aria-label="Diminuer"
                    >
                      <Minus size={14} />
                    </button>
                    <span className="w-7 text-center text-[13px] font-bold tabular-nums">{qty}</span>
                    <button
                      type="button"
                      onClick={() => increment(a.id)}
                      className="w-7 h-7 rounded-md bg-navy text-white flex items-center justify-center transition-opacity hover:opacity-90"
                      aria-label="Augmenter"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <div className="mb-2 text-[11px] text-terra bg-terra-light border border-terra-mid rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={() => generateFacture(true)}
        disabled={loading || totalSelected === 0}
        className="w-full bg-ok text-white py-3 rounded-xl font-bold text-[14px] disabled:opacity-50 transition-opacity hover:opacity-90 inline-flex items-center justify-center gap-1.5"
      >
        {loading ? 'Génération…' : (
          <>
            <CreditCard size={16} />
            Générer facture ({totalSelected} ligne{totalSelected > 1 ? 's' : ''})
          </>
        )}
      </button>

      <button
        type="button"
        onClick={() => generateFacture(false)}
        disabled={loading}
        className="w-full mt-2 text-[11px] text-ink-mid hover:text-navy underline disabled:opacity-50"
      >
        Passer sans article (tarif paramètre par défaut)
      </button>
    </section>
  );
}
