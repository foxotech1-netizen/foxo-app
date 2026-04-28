import { AssistantChat, type QuickAction } from './AssistantChat';

export const dynamic = 'force-dynamic';

const QUICK_ACTIONS: QuickAction[] = [
  { icon: '⏰', label: 'Interventions en retard', prompt: 'Liste-moi les interventions en retard (créneau dépassé sans clôture). Pour chacune : ref, ACP, statut actuel, technicien assigné, et action recommandée.' },
  { icon: '☀️', label: 'Résumé du jour', prompt: 'Donne-moi un résumé du programme d\'aujourd\'hui : interventions prévues avec heures et techniciens, alertes du moment, ce qui demande mon attention en priorité.' },
  { icon: '✉️', label: 'Rédiger email syndic', prompt: 'Aide-moi à rédiger un email type pour un syndic. Demande-moi d\'abord le contexte (quelle intervention, quel objectif : confirmation RDV, demande d\'info, transmission rapport, etc.) puis propose un brouillon.' },
  { icon: '📊', label: 'Analyser l\'activité', prompt: 'Analyse l\'état du tableau de bord FoxO : équilibre par statut, charge des techniciens, dossiers qui patinent, urgences. Propose 3 actions concrètes à mener cette semaine.' },
  { icon: '⚡', label: 'Urgences', prompt: 'Liste-moi les interventions urgentes non clôturées avec leur statut et ce qui bloque. Trie par priorité d\'action.' },
  { icon: '⏸', label: 'En suspens', prompt: 'Liste les dossiers en suspens avec leur motif. Pour chacun, suggère une action de relance ou une décision à prendre.' },
];

export default function AssistantPage() {
  return (
    <>
      <header className="px-6 py-4 flex items-center justify-between bg-sand border-b border-sand-border flex-shrink-0">
        <div>
          <h1 className="text-xl font-extrabold text-ink">✨ Assistant Claude</h1>
          <p className="text-[11px] text-ink-muted mt-0.5">
            Pose n&apos;importe quelle question sur l&apos;activité FoxO. Claude a accès aux interventions, syndics et techniciens en temps réel.
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-hidden px-6 py-5">
        <div className="h-full max-w-[900px] mx-auto">
          <AssistantChat
            mode="global"
            quickActions={QUICK_ACTIONS}
            emptyTitle="Comment puis-je t'aider ?"
            emptyHint="Je vois en direct l'état des interventions, des syndics et du planning. Clique une action rapide ci-dessus, ou tape ta propre question."
          />
        </div>
      </div>
    </>
  );
}
