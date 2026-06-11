import type { LucideIcon } from 'lucide-react';

// Ligne compacte pour une section à zéro (Alertes, File de validation…) :
// remplace le bandeau couleur pleine largeur + cadre vide par une seule
// ligne neutre. La couleur de la section survit en pastille discrète.
export type CollapsedTone = 'terra' | 'amber' | 'navy';

const TONE_VAR: Record<CollapsedTone, string> = {
  terra: 'var(--color-terra)',
  amber: 'var(--color-amber-foxo)',
  navy: 'var(--color-navy)',
};

export function CollapsedSection({
  icon: Icon, title, count = 0, tone = 'navy',
}: {
  icon: LucideIcon;
  title: string;
  count?: number;
  tone?: CollapsedTone;
}) {
  return (
    <section>
      <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-sand-border bg-sand">
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: TONE_VAR[tone] }}
          aria-hidden
        />
        <Icon size={14} className="text-ink-muted" aria-hidden />
        <h2 className="flex-1 text-[12px] font-bold text-ink-mid">{title}</h2>
        <span className="text-[11px] font-extrabold text-ink-muted bg-cream border border-sand-border rounded-full px-2 py-0.5">
          {count}
        </span>
      </div>
    </section>
  );
}
