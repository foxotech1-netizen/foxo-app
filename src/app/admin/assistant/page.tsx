import { Sparkles } from 'lucide-react';
import { AssistantChat } from './AssistantChat';

export const dynamic = 'force-dynamic';

export default function AssistantPage() {
  return (
    <>
      <div className="mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <h1 className="fxs-page-title mb-1 inline-flex items-center gap-2">
          <Sparkles size={18} className="text-[var(--color-navy)]" aria-hidden />
          Assistant FoxO
        </h1>
        <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
          <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
          Pose n&apos;importe quelle question sur l&apos;activité FoxO. L&apos;assistant a accès aux interventions, syndics et techniciens en temps réel
        </div>
      </div>

      <div>
        <div className="h-full max-w-[900px] mx-auto">
          {/* Les actions rapides (avec leurs icônes lucide) sont définies
              côté client dans AssistantChat — un server component ne peut pas
              passer de composants/fonctions en props (crash RSC). */}
          <AssistantChat mode="global" />
        </div>
      </div>
    </>
  );
}
