import { FacturationTabs } from './FacturationTabs';

// Layout du module facturation : titre du module AU-DESSUS de la
// sous-navigation (comme les autres pages admin), puis barre d'onglets
// visible sur toutes les sous-pages (factures, notes-crédit, paiements,
// rappels, export). Le Catalogue (/admin/articles) ré-utilise cette même
// barre via son propre layout pour rester dans le module visuellement.
export default function FacturationLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="mb-3">
        <h1 className="fxs-page-title mb-1">Facturation</h1>
        <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
          <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
          Factures, devis, paiements et relances
        </div>
      </div>
      <FacturationTabs />
      {children}
    </>
  );
}
