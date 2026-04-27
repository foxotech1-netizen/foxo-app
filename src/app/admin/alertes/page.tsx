import { ComingSoon } from '@/components/ComingSoon';

export default function AlertesPage() {
  return (
    <ComingSoon
      title="Alertes"
      subtitle="Interventions urgentes & en suspens"
      icon="◉"
      description="Vue centralisée de toutes les interventions qui demandent ton attention immédiate : urgences non assignées, dossiers en suspens, créneaux manqués."
      features={[
        'Liste filtrée des interventions en_suspens et nouvelles non assignées',
        'Notification temps réel des nouveaux dossiers urgents',
        'Affectation rapide à un technicien depuis la liste',
        'Historique des alertes traitées',
      ]}
    />
  );
}
