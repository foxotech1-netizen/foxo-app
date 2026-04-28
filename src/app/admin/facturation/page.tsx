import { ComingSoon } from '@/components/ComingSoon';

export default function FacturationPage() {
  return (
    <ComingSoon
      title="Facturation"
      subtitle="Vue d'ensemble des factures émises"
      icon="🧾"
      description="Pour l'instant, la facturation se fait depuis le drawer d'une intervention (onglet Suivi → bloc Facture). Cette page centralisera bientôt la liste, les exports et les relances."
      features={[
        'Liste des factures (numéro, montant, statut paiement)',
        'Filtres : non payées / en retard / payées',
        'Export comptable (CSV / XML belge)',
        'Relances automatiques par email',
        'Tableau de bord encaissements',
      ]}
    />
  );
}
