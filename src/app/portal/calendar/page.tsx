import Link from 'next/link';
import { Check, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { getCurrentSyndic } from '@/lib/portal/syndic';
import {
  formatMonthParam,
  getMonthSlots,
  parseMonthParam,
  shiftMonth,
} from '@/lib/portal/availability';

export const dynamic = 'force-dynamic';

const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];
const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const sp = await searchParams;
  const session = await getCurrentSyndic();
  if (!session) return null;

  const { year, month } = parseMonthParam(sp.m);
  const slots = await getMonthSlots(year, month);

  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, +1);

  // Group slots by date
  const byDate = new Map<string, typeof slots>();
  for (const s of slots) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date)!.push(s);
  }

  // Build calendar grid (lun-dim)
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);
  const startDow = (firstOfMonth.getDay() + 6) % 7; // 0=Lun
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  type Cell = {
    key: string;
    day: number;
    inMonth: boolean;
    iso: string;
    isToday: boolean;
    slots: typeof slots;
  };
  const cells: Cell[] = [];

  // Pad start
  for (let i = 0; i < startDow; i++) {
    const d = new Date(year, month, -(startDow - i - 1));
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    cells.push({ key: `pad-${i}`, day: d.getDate(), inMonth: false, iso, isToday: false, slots: [] });
  }
  for (let d = 1; d <= lastOfMonth.getDate(); d++) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({
      key: iso,
      day: d,
      inMonth: true,
      iso,
      isToday: iso === todayStr,
      slots: byDate.get(iso) ?? [],
    });
  }
  // Pad end
  while (cells.length % 7 !== 0) {
    cells.push({ key: `tail-${cells.length}`, day: 0, inMonth: false, iso: '', isToday: false, slots: [] });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-ink">Disponibilités FoxO</h1>
          <p className="text-xs text-ink-mid mt-0.5">
            Cliquez sur un créneau libre pour pré-remplir une demande.
          </p>
        </div>
      </div>

      <div className="bg-cream rounded-xl border border-sand-border overflow-hidden">
        <div className="flex justify-between items-center px-4 py-3 border-b border-sand-border">
          <span className="text-base font-bold text-ink">
            {MONTHS[month]} {year}
          </span>
          <div className="flex gap-2">
            <Link
              href={`/portal/calendar?m=${formatMonthParam(prev.year, prev.month)}`}
              className="bg-sand-mid w-8 h-8 rounded-md text-ink-mid flex items-center justify-center hover:bg-sand-border"
            ><ChevronLeft size={16} /></Link>
            <Link
              href={`/portal/calendar?m=${formatMonthParam(next.year, next.month)}`}
              className="bg-sand-mid w-8 h-8 rounded-md text-ink-mid flex items-center justify-center hover:bg-sand-border"
            ><ChevronRight size={16} /></Link>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-px bg-sand-border">
          {DAYS.map((d) => (
            <div key={d} className="bg-sand text-center py-2 text-[10px] font-bold text-ink-muted uppercase">
              {d}
            </div>
          ))}
          {cells.map((c) => (
            <div
              key={c.key}
              className={
                'p-1.5 sm:p-2 min-h-[80px] ' +
                (c.inMonth
                  ? c.isToday ? 'bg-navy-pale' : 'bg-cream'
                  : 'bg-[#FAFAF8] opacity-50')
              }
            >
              {c.inMonth && (
                <div
                  className={
                    'text-[11px] font-semibold mb-1 ' +
                    (c.isToday ? 'text-navy font-extrabold' : 'text-ink-mid')
                  }
                >
                  {c.day}
                </div>
              )}
              <div className="space-y-0.5">
                {c.slots.map((s) => {
                  const time = s.hour.replace(':', 'h');
                  if (s.status === 'libre') {
                    return (
                      <Link
                        key={s.iso}
                        href={`/portal/nouveau?date=${s.date}&heure=${s.hour}`}
                        className="inline-flex items-center gap-1 text-[10px] font-semibold rounded px-1.5 py-0.5 bg-ok-light text-ok hover:bg-[#C8E5D5] truncate"
                      >
                        {time} <Check size={12} />
                      </Link>
                    );
                  }
                  if (s.status === 'reserve') {
                    return (
                      <div
                        key={s.iso}
                        className="inline-flex items-center gap-1 text-[10px] font-semibold rounded px-1.5 py-0.5 bg-navy-light text-navy truncate"
                      >
                        {time} <X size={12} />
                      </div>
                    );
                  }
                  return null; // 'passe' = on ne rend pas
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-4 px-4 py-3 border-t border-sand-border">
          <Legend color="bg-ok-light" border="border-ok-mid" label="Disponible" />
          <Legend color="bg-navy-light" border="border-navy-mid" label="Réservé" />
        </div>
      </div>
    </div>
  );
}

function Legend({ color, border, label }: { color: string; border: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-ink-mid">
      <span className={`w-3 h-3 rounded-sm ${color} ${border} border`} />
      {label}
    </div>
  );
}
