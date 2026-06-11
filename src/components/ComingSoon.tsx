// Page placeholder pour les sections admin pas encore implémentées.
// Réutilise les conventions du layout admin (topbar sand, body sand-bg).

import { Construction, type LucideIcon } from 'lucide-react';

export function ComingSoon({
  title,
  subtitle,
  description,
  features,
  icon: Icon = Construction,
}: {
  title: string;
  subtitle?: string;
  description: string;
  features?: string[];
  icon?: LucideIcon;
}) {
  return (
    <>
      <header className="px-6 py-4 flex items-center justify-between bg-sand border-b border-sand-border flex-shrink-0">
        <div>
          <h1 className="fxs-title-sm">{title}</h1>
          {subtitle && (
            <p className="text-[11px] text-ink-muted mt-0.5">{subtitle}</p>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 py-8">
        <div className="bg-cream border border-sand-border rounded-2xl p-8 sm:p-10 max-w-[640px] mx-auto text-center">
          <div className="mb-3 flex justify-center text-ink-mid"><Icon size={48} /></div>
          <h2 className="fxs-section-title text-ink mb-2">
            En cours de développement
          </h2>
          <p className="text-sm text-ink-mid leading-relaxed">
            {description}
          </p>

          {features && features.length > 0 && (
            <div className="bg-sand rounded-xl p-4 text-left mt-6 border border-sand-border">
              <div className="text-[10px] uppercase tracking-wider font-bold text-ink-muted mb-2">
                Fonctionnalités prévues
              </div>
              <ul className="space-y-2 text-[13px] text-ink-mid">
                {features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span className="text-navy mt-0.5">·</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
