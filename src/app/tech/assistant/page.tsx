import { AssistantChat, type QuickAction } from '@/app/admin/assistant/AssistantChat';

export const dynamic = 'force-dynamic';

// Suggestions adaptées au technicien (sans icône : un server component ne peut
// pas passer de fonctions/icônes lucide à un client component).
const TECH_QUICK_ACTIONS: QuickAction[] = [
  { label: 'Mes interventions du jour', prompt: 'Quelles sont mes interventions prévues aujourd\'hui ? Pour chacune : référence, adresse, heure du créneau et statut.' },
  { label: 'Ma semaine', prompt: 'Liste mes interventions de cette semaine, triées par date et heure, avec référence, adresse et statut.' },
  { label: 'Détail d\'un dossier', prompt: 'Je veux le détail d\'un de mes dossiers. Demande-moi sa référence, puis donne-moi l\'adresse, les occupants, le créneau et l\'état du rapport.' },
];

export default function TechAssistantPage() {
  return (
    <div
      className="fixed left-0 right-0 z-30 px-4 pt-3 pb-2"
      style={{ top: '4rem', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 84px)' }}
    >
      <div className="max-w-[640px] mx-auto h-full">
        <AssistantChat
          mode="global"
          endpoint="/api/tech/assistant/chat"
          quickActions={TECH_QUICK_ACTIONS}
          emptyTitle="Comment puis-je t'aider ?"
          emptyHint="J'ai accès à tes interventions et à ton planning. Touche une suggestion ci-dessus, ou pose ta question."
          placeholder="Pose ta question…"
          className="flex flex-col h-full"
        />
      </div>
    </div>
  );
}
