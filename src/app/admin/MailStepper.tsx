// Stepper visuel pour les interventions source='mail' :
//   ① Infos → ② Technicien → ③ Créneau → ④ Occupants notifiés → ⑤ Confirmation
// Couleurs : navy actif, vert complété, gris en attente.
//
// Pure présentation — détermination des steps faite par le parent
// (qui a accès à l'intervention + occupants chargés).

interface StepDef {
  key: string;
  label: string;
  done: boolean;
  active?: boolean;
}

export function MailStepper({ steps }: { steps: StepDef[] }) {
  return (
    <div className="bg-cream border border-sand-border rounded-xl p-3 mb-3 dark:bg-[#1C1A16] dark:border-[#2C2A24]">
      <div className="flex items-center justify-between gap-1">
        {steps.map((s, idx) => {
          const last = idx === steps.length - 1;
          const stateColor = s.done ? '#1F6B45' : s.active ? '#1B3A6B' : '#A09A8E';
          const stateBg = s.done ? '#E4F2EB' : s.active ? '#EBF2FB' : 'transparent';
          return (
            <div key={s.key} className="flex items-center flex-1 min-w-0">
              <div className="flex flex-col items-center gap-1 min-w-0">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold flex-shrink-0"
                  style={{
                    background: stateBg,
                    color: stateColor,
                    border: `1.5px solid ${stateColor}`,
                  }}
                >
                  {s.done ? '✓' : idx + 1}
                </div>
                <span
                  className="text-[9px] font-semibold uppercase tracking-wider text-center truncate w-full"
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
