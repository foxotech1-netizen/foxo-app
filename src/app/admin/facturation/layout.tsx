import { FacturationTabs } from './FacturationTabs';

// Layout du module facturation : sous-navigation horizontale visible
// sur toutes les sous-pages (factures, notes-crédit, paiements, rappels,
// export). Le Catalogue (/admin/articles) ré-utilise cette même barre
// via son propre layout pour rester dans le module visuellement.
export default function FacturationLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <FacturationTabs />
      {children}
    </>
  );
}
