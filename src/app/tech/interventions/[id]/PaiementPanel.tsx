'use client';

import { useEffect, useState } from 'react';
import { Check, CreditCard, Minus, Pencil, Plus } from 'lucide-react';
import { QrPaiement } from '@/components/QrPaiement';
import type { FactureLigne } from '@/lib/types/database';

type FactureLite = {
  id: string;
  numero: string;
  total_ttc: number;
  statut: string;
  lignes: FactureLigne[];
  client_nom: string | null;
  client_email: string | null;
  client_adresse: string | null;
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

  // Informations de facturation (form inline post-création) — un seul
  // bouton Enregistrer envoie les 4 champs en PATCH.
  const [refValue, setRefValue] = useState('');
  const [clientNom, setClientNom] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientAdresse, setClientAdresse] = useState('');
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
      const f = data.facture as FactureLite;
      setFacture(f);
      // Pré-remplit les champs client/ref depuis la facture (état serveur).
      setClientNom(f.client_nom ?? '');
      setClientEmail(f.client_email ?? '');
      setClientAdresse(f.client_adresse ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur réseau.');
    } finally {
      setLoading(false);
    }
  }

  // Reconstruit le state `selected` (Map<articleId, quantite>) à partir
  // des lignes de la facture courante puis revient en mode sélection
  // (state A). Match d'une ligne à un article : par article_code en
  // priorité, fallback sur description. Les lignes legacy sans match
  // dans le catalogue sont silencieusement omises.
  function startEdit() {
    if (!facture || !catalog) return;
    const newSelected = new Map<string, number>();
    for (const ligne of facture.lignes) {
      let article: CatalogArticle | undefined;
      if (ligne.article_code) {
        article = catalog.find((c) => c.code === ligne.article_code);
      }
      if (!article) {
        article = catalog.find((c) => c.description === ligne.description);
      }
      if (article) {
        newSelected.set(article.id, ligne.quantite);
      }
    }
    setSelected(newSelected);
    setFacture(null);
  }

  async function saveClient() {
    if (!facture) return;
    setRefSaving(true);
    setRefError(null);
    setRefSaved(false);
    try {
      const r = await fetch(`/api/tech/facture/${facture.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ref_bon_commande: refValue,
          client_nom: clientNom,
          client_email: clientEmail,
          client_adresse: clientAdresse,
        }),
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
      <section
        className="bg-[var(--color-cream)] rounded-xl p-4"
        style={{ boxShadow: 'var(--shadow-card)' }}
      >
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5">
            <span className="w-[3px] h-3.5 rounded-sm bg-[var(--accent-tech)]"></span>
            <div className="font-sora text-[11px] font-medium text-[var(--color-ink-mid)] uppercase tracking-[0.12em]">Paiement sur place</div>
          </div>
          <button
            type="button"
            onClick={startEdit}
            className="text-[13px] font-semibold text-[var(--color-navy)] underline hover:no-underline inline-flex items-center gap-1 min-h-[44px]"
          >
            <Pencil size={13} />Modifier
          </button>
        </div>
        <QrPaiement
          factureId={facture.id}
          numero={facture.numero}
          montantTTC={facture.total_ttc}
        />
        <div className="mt-4 pt-4 border-t border-[var(--color-sand-border)]">
          <div className="flex items-center gap-2.5 mb-3">
            <span className="w-[3px] h-3.5 rounded-sm bg-[var(--accent-tech)]"></span>
            <div className="font-sora text-[11px] font-medium text-[var(--color-ink-mid)] uppercase tracking-[0.12em]">Informations de facturation</div>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-ink-mid)] block mb-1.5">
                Référence client
              </label>
              <input
                type="text"
                value={refValue}
                onChange={(e) => setRefValue(e.target.value)}
                placeholder="ex: BC-2024-001"
                className="w-full px-3.5 py-3 border border-[var(--color-sand-border)] rounded-md text-[14px] bg-[var(--color-cream)] text-[var(--color-ink)] outline-none focus:border-[var(--accent-tech)] min-h-[44px]"
                maxLength={100}
              />
            </div>
            <div>
              <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-ink-mid)] block mb-1.5">
                Nom / société
              </label>
              <input
                type="text"
                value={clientNom}
                onChange={(e) => setClientNom(e.target.value)}
                placeholder="ex: ACP Résidence Les Pins"
                className="w-full px-3.5 py-3 border border-[var(--color-sand-border)] rounded-md text-[14px] bg-[var(--color-cream)] text-[var(--color-ink)] outline-none focus:border-[var(--accent-tech)] min-h-[44px]"
                maxLength={200}
              />
            </div>
            <div>
              <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-ink-mid)] block mb-1.5">
                Adresse de facturation
              </label>
              <textarea
                value={clientAdresse}
                onChange={(e) => setClientAdresse(e.target.value)}
                placeholder="Rue, code postal, ville"
                rows={2}
                maxLength={500}
                className="w-full px-3.5 py-3 border border-[var(--color-sand-border)] rounded-md text-[14px] bg-[var(--color-cream)] text-[var(--color-ink)] outline-none focus:border-[var(--accent-tech)] resize-y"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-ink-mid)] block mb-1.5">
                Email copie facture
              </label>
              <input
                type="email"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                placeholder="ex: comptabilite@syndic.be"
                className="w-full px-3.5 py-3 border border-[var(--color-sand-border)] rounded-md text-[14px] bg-[var(--color-cream)] text-[var(--color-ink)] outline-none focus:border-[var(--accent-tech)] min-h-[44px]"
                maxLength={200}
              />
            </div>
            <button
              type="button"
              onClick={saveClient}
              disabled={refSaving}
              className="w-full bg-[var(--color-navy)] hover:bg-[var(--color-navy-dark)] text-[var(--color-cream)] py-3 rounded-md text-[14px] font-semibold transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-1.5 min-h-[48px]"
            >
              {refSaved ? (
                <><Check size={15} />Enregistré</>
              ) : refSaving ? 'Sauvegarde…' : 'Enregistrer'}
            </button>
            {refError && (
              <div className="text-[12px] text-[var(--color-terra)] font-semibold">{refError}</div>
            )}
          </div>
        </div>
      </section>
    );
  }

  // ─── Catalogue en cours de chargement ─────────────────────────────
  if (catalog === null) {
    return (
      <section
        className="bg-[var(--color-cream)] rounded-xl p-4"
        style={{ boxShadow: 'var(--shadow-card)' }}
      >
        <div className="flex items-center gap-2.5 mb-2">
          <span className="w-[3px] h-3.5 rounded-sm bg-[var(--accent-tech)]"></span>
          <div className="font-sora text-[11px] font-medium text-[var(--color-ink-mid)] uppercase tracking-[0.12em]">Paiement sur place</div>
        </div>
        <div className="text-[13px] text-[var(--color-ink-mid)]">Chargement du catalogue…</div>
      </section>
    );
  }

  // ─── STATE A : sélection articles ─────────────────────────────────
  const totalSelected = Array.from(selected.values()).reduce((s, q) => s + q, 0);

  return (
    <section
      className="bg-[var(--color-cream)] rounded-xl p-4"
      style={{ boxShadow: 'var(--shadow-card)' }}
    >
      <div className="flex items-center gap-2.5 mb-3">
        <span className="w-[3px] h-3.5 rounded-sm bg-[var(--accent-tech)]"></span>
        <div className="font-sora text-[11px] font-medium text-[var(--color-ink-mid)] uppercase tracking-[0.12em]">Paiement sur place</div>
      </div>

      {catalogError && (
        <div className="mb-3 text-[12px] text-[var(--color-terra)] bg-[var(--color-terra-light)] border border-[var(--color-terra-mid)] rounded-md px-3 py-2">
          {catalogError}
        </div>
      )}

      {catalog.length === 0 && !catalogError && (
        <div className="text-[13px] text-[var(--color-ink-mid)] italic mb-3">
          Aucun article au catalogue. Utilise « Passer sans article ».
        </div>
      )}

      {catalog.length > 0 && (
        <div className="grid gap-2.5 mb-3">
          {catalog.map((a) => {
            const qty = selected.get(a.id) ?? 0;
            const ttc = a.prix_htva * (1 + a.tva_pct / 100);
            const isSelected = qty > 0;
            return (
              <div
                key={a.id}
                className={
                  'border-2 rounded-lg p-3.5 transition-colors ' +
                  (isSelected ? 'border-[var(--color-ok)] bg-[var(--color-ok-light)]/30' : 'border-[var(--color-sand-border)] bg-[var(--color-cream)]')
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold text-[var(--color-ink)]">{a.description}</div>
                    <div className="text-[12px] text-[var(--color-ink-mid)] mt-0.5">
                      <span className="font-sora font-semibold text-[var(--color-ink)]">{fmtMoney(ttc)}</span> TTC
                      {a.code && <span className="ml-2 font-mono text-[var(--color-ink-mid)]">[{a.code}]</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => decrement(a.id)}
                      disabled={qty === 0}
                      className="w-11 h-11 rounded-md bg-[var(--color-sand-mid)] text-[var(--color-navy)] flex items-center justify-center disabled:opacity-30 transition-opacity hover:opacity-80 min-h-[44px] min-w-[44px]"
                      aria-label="Diminuer"
                    >
                      <Minus size={16} />
                    </button>
                    <span className="font-sora w-7 text-center text-[15px] font-semibold tabular-nums text-[var(--color-ink)]">{qty}</span>
                    <button
                      type="button"
                      onClick={() => increment(a.id)}
                      className="w-11 h-11 rounded-md bg-[var(--color-navy)] hover:bg-[var(--color-navy-dark)] text-[var(--color-cream)] flex items-center justify-center transition-colors min-h-[44px] min-w-[44px]"
                      aria-label="Augmenter"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <div className="mb-3 text-[12px] text-[var(--color-terra)] bg-[var(--color-terra-light)] border border-[var(--color-terra-mid)] rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={() => generateFacture(true)}
        disabled={loading || totalSelected === 0}
        className="w-full bg-[var(--color-ok)] text-[var(--color-cream)] py-3.5 rounded-xl font-semibold text-[15px] disabled:opacity-50 transition-opacity hover:opacity-90 inline-flex items-center justify-center gap-2 min-h-[48px]"
      >
        {loading ? 'Génération…' : (
          <>
            <CreditCard size={18} />
            Générer facture ({totalSelected} ligne{totalSelected > 1 ? 's' : ''})
          </>
        )}
      </button>

      <button
        type="button"
        onClick={() => generateFacture(false)}
        disabled={loading}
        className="w-full mt-2 text-[12px] text-[var(--color-ink-mid)] hover:text-[var(--color-navy)] underline disabled:opacity-50 min-h-[44px]"
      >
        Passer sans article (tarif paramètre par défaut)
      </button>
    </section>
  );
}
