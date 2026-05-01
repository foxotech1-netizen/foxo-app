import { FacturationTabs } from '../facturation/FacturationTabs';

// Articles = Catalogue, rattaché visuellement au module facturation pour
// que la sous-nav reste cohérente quand l'admin est sur cet onglet.
export default function ArticlesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <FacturationTabs />
      {children}
    </>
  );
}
