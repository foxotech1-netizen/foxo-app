import { ImportOdooClient } from './ImportOdooClient';

export const dynamic = 'force-dynamic';
// L'action importOdoo (segment de cette page) parse + insère jusqu'à
// plusieurs centaines de pièces par lots de 50.
export const maxDuration = 120;

export default function ImportOdooPage() {
  return (
    <>
      <div className="mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <h1 className="fxs-page-title mb-1">Import Odoo</h1>
        <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
          <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
          Reprise de l&apos;historique 2026 — factures clients et fournisseurs (CSV)
        </div>
      </div>

      <div className="bg-navy-pale border border-navy-light rounded-xl px-4 py-3 mb-5 text-[12px] text-ink space-y-1 max-w-[860px]">
        <p><strong>Mode d&apos;emploi</strong> — exporte depuis Odoo les factures clients et fournisseurs (période attendue : <strong>à partir du 01/01/2026</strong>), puis dépose chaque CSV ci-dessous.</p>
        <p>Un <strong>aperçu à blanc</strong> est toujours affiché avant toute écriture. L&apos;import est <strong>relançable sans doublon</strong> (déduplication par numéro Odoo). Les <strong>relances sont suspendues</strong> sur toutes les factures importées. Les avoirs et les pièces non comptabilisées sont ignorés. La date de paiement n&apos;étant pas dans l&apos;export Odoo, les pièces payées sont importées sans date de paiement.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 max-w-[1200px]">
        <ImportOdooClient kind="ventes" titre="Factures clients (ventes)" />
        <ImportOdooClient kind="achats" titre="Factures fournisseurs (achats)" />
      </div>
    </>
  );
}
