import { FacturationTabs } from '../facturation/FacturationTabs';

// Notes de frais est une sous-section du module Comptabilité — on
// rend les FacturationTabs pour permettre la navigation latérale entre
// Factures / Devis / Notes de crédit / Notes de frais / Paiements /
// Rappels / Catalogue / Export.
//
// Le composant vit physiquement hors de /admin/facturation/ pour
// garder son périmètre propre (table notes_frais, server actions
// dédiées) — donc on importe les tabs en relatif.
export default function NotesFraisLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <FacturationTabs />
      {children}
    </>
  );
}
