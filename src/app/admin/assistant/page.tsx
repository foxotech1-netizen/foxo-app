import { Clock, Sun, Mail, BarChart3, Zap, Pause, Sparkles } from 'lucide-react';
import { AssistantChat, type QuickAction } from './AssistantChat';

export const dynamic = 'force-dynamic';

const QUICK_ACTIONS: QuickAction[] = [
  { icon: Clock, label: 'Interventions en retard', prompt: 'Liste-moi les interventions en retard (créneau dépassé sans clôture). Pour chacune : ref, ACP, statut actuel, technicien assigné, et action recommandée.' },
  { icon: Sun, label: 'Résumé du jour', prompt: 'Donne-moi un résumé du programme d\'aujourd\'hui : interventions prévues avec heures et techniciens, alertes du moment, ce qui demande mon attention en priorité.' },
  { icon: Mail, label: 'Rédiger email syndic', prompt: 'Aide-moi à rédiger un email type pour un syndic. Demande-moi d\'abord le contexte (quelle intervention, quel objectif : confirmation RDV, demande d\'info, transmission rapport, etc.) puis propose un brouillon.' },
  { icon: BarChart3, label: 'Analyser l\'activité', prompt: 'Analyse l\'état du tableau de bord FoxO : équilibre par statut, charge des techniciens, dossiers qui patinent, urgences. Propose 3 actions concrètes à mener cette semaine.' },
  { icon: Zap, label: 'Urgences', prompt: 'Liste-moi les interventions urgentes non clôturées avec leur statut et ce qui bloque. Trie par priorité d\'action.' },
  { icon: Pause, label: 'En suspens', prompt: 'Liste les dossiers en suspens avec leur motif. Pour chacun, suggère une action de relance ou une décision à prendre.' },
];

export default function AssistantPage() {
  return (
    <>
      <div className="mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <h1 className="fxs-page-title mb-1 inline-flex items-center gap-2">
          <Sparkles size={18} className="text-[var(--color-navy)]" aria-hidden />
          Assistant <span>Claude</span>
        </h1>
        <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
          <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
          Pose n&apos;importe quelle question sur l&apos;activité FoxO. Claude a accès aux interventions, syndics et techniciens en temps réel
        </div>
      </div>

      <div>
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
