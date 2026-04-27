import { ComingSoon } from '@/components/ComingSoon';

export default function PlanningPage() {
  return (
    <ComingSoon
      title="Planning"
      subtitle="Calendrier des interventions"
      icon="▷"
      description="Vue calendrier de toutes les interventions assignées aux techniciens FoxO. Drag-and-drop pour réassigner, filtres par technicien, vue jour/semaine/mois."
      features={[
        'Calendrier mois / semaine / jour',
        'Code couleur par technicien (Mertens, Renard)',
        'Drag-and-drop pour réassigner ou décaler un créneau',
        'Sync bidirectionnel avec Google Calendar',
        'Détection des conflits de planning',
      ]}
    />
  );
}
