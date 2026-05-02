import { ComingSoon } from '@/components/ComingSoon';

export const dynamic = 'force-dynamic';

export default function TechniciensPage() {
  return (
    <ComingSoon
      icon="🔧"
      title="Techniciens"
      subtitle="Équipe terrain"
      description="Gestion centralisée des techniciens FoxO : profils, couleurs planning, statut en ligne et historique d'interventions."
      features={[
        'Liste des techniciens avec couleur planning et statut en ligne',
        'Ajouter / modifier / désactiver un technicien',
        'Historique des interventions par technicien avec lien vers chaque dossier',
      ]}
    />
  );
}
