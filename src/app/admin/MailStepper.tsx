// Stepper visuel pour les interventions source='mail' :
//   ① Infos → ② Technicien → ③ Créneau → ④ Occupants notifiés → ⑤ Confirmation
// Couleurs : navy actif, vert complété, gris en attente.
//
// Pure présentation — détermination des steps faite par le parent
// (qui a accès à l'intervention + occupants chargés).
//
// Navigation : si la step a un sectionId ET est complétée ou active,
// le cercle devient cliquable et scroll vers la section correspondante
// dans le drawer (via document.getElementById + scrollIntoView).
// Les futures étapes (pas encore complétées et non actives) restent
// non-cliquables (curseur default + pas de hover).

import { Check } from 'lucide-react';

interface StepDef {
  key: string;
  label: string;
  done: boolean;
  active?: boolean;
  sectionId?: string;     // id de l'élément cible pour le scroll
}

export function MailStepper({ steps }: { steps: StepDef[] }) {
  function handleClick(step: StepDef) {
    if (!step.sectionId) return;
    const el = typeof document !== 'undefined' ? document.getElementById(step.sectionId) : null;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="bg-cream border border-sand-border rounded-xl p-3 mb-3 dark:bg-[#1C1A16] dark:border-[#2C2A24]">
      <div className="flex items-center justify-between gap-1">
        {steps.map((s, idx) => {
          const last = idx === steps.length - 1;
          const stateColor = s.done ? '#1F6B45' : s.active ? '#1B3A6B' : '#A09A8E';
          const stateBg = s.done ? '#E4F2EB' : s.active ? '#EBF2FB' : 'transparent';
          const clickable = Boolean(s.sectionId) && (s.done || s.active);
          return (
            <div key={s.key} className="flex items-center flex-1 min-w-0">
              <div
                className={
                  'flex flex-col items-center gap-1 min-w-0 ' +
                  (clickable ? 'cursor-pointer group' : 'cursor-default')
                }
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                onClick={clickable ? () => handleClick(s) : undefined}
                onKeyDown={clickable
                  ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(s); } }
                  : undefined}
                aria-label={clickable ? `Aller à la section ${s.label}` : undefined}
                title={clickable ? `Aller à ${s.label}` : undefined}
              >
                <div
                  className={
                    'w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold flex-shrink-0 transition-transform ' +
                    (clickable ? 'group-hover:scale-110 group-hover:shadow-md' : '')
                  }
                  style={{
                    background: stateBg,
                    color: stateColor,
                    border: `1.5px solid ${stateColor}`,
                  }}
                >
                  {s.done ? <Check size={14} /> : idx + 1}
                </div>
                <span
                  className={
                    'text-[9px] font-semibold uppercase tracking-wider text-center truncate w-full ' +
                    (clickable ? 'group-hover:underline' : '')
                  }
                  style={{ color: stateColor }}
                  title={s.label}
                >
                  {s.label}
                </span>
              </div>
              {!last && (
                <div
                  className="flex-1 h-[2px] mx-1 rounded"
                  style={{ background: s.done ? '#1F6B45' : '#DDD8CC' }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
