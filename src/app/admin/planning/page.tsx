import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { TECH_EMAILS } from '@/lib/auth/roles';
import { fmtDateTime } from '@/lib/format';
import type { Acp, Intervention, Utilisateur } from '@/lib/types/database';

export const dynamic = 'force-dynamic';

const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];
const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

// Couleurs assignées aux techs (max 4 ; au-delà cycle)
const TECH_COLORS = [
  { bg: '#1B3A6B', fg: '#FFFFFF', soft: '#D6E4F7' }, // navy
  { bg: '#A17244', fg: '#FFFFFF', soft: '#F0DCC4' }, // ambre
  { bg: '#1F6B45', fg: '#FFFFFF', soft: '#D4EDE2' }, // ok
  { bg: '#C4622D', fg: '#FFFFFF', soft: '#F7EDE5' }, // terra
];

function parseMonthParam(input: string | undefined): { year: number; month: number } {
  if (input && /^\d{4}-\d{2}$/.test(input)) {
    const [y, m] = input.split('-').map(Number);
    if (m >= 1 && m <= 12) return { year: y, month: m - 1 };
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

function formatMonthParam(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const sp = await searchParams;
  const { year, month } = parseMonthParam(sp.m);

  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));

  const supabase = await createClient();

  const [ivRes, techRes] = await Promise.all([
    supabase
      .from('interventions')
      .select('id, ref, type, creneau_debut, technicien_id, acp_id, statut')
      .gte('creneau_debut', start.toISOString())
      .lt('creneau_debut', end.toISOString())
      .in('statut', ['confirmee', 'realisee', 'rapport', 'cloturee'])
      .not('creneau_debut', 'is', null)
      .order('creneau_debut', { ascending: true }),
    supabase
      .from('utilisateurs')
      .select('id, prenom, nom, email')
      .in('email', TECH_EMAILS as unknown as string[]),
  ]);

  const interventions = (ivRes.data ?? []) as Pick<Intervention,
    'id' | 'ref' | 'type' | 'creneau_debut' | 'technicien_id' | 'acp_id' | 'statut'>[];
  const techs = (techRes.data ?? []) as Utilisateur[];

  const acpIds = Array.from(new Set(interventions.map((i) => i.acp_id).filter(Boolean) as string[]));
  const acpRes = acpIds.length
    ? await supabase.from('acps').select('id, nom').in('id', acpIds)
    : { data: [] };
  const acpMap = new Map(((acpRes.data ?? []) as Pick<Acp, 'id' | 'nom'>[]).map((a) => [a.id, a.nom]));

  // Couleur par tech
  const techColorMap = new Map<string, typeof TECH_COLORS[number]>();
  techs.forEach((t, i) => techColorMap.set(t.id, TECH_COLORS[i % TECH_COLORS.length]));

  // Group by date YYYY-MM-DD
  const byDate = new Map<string, typeof interventions>();
  for (const iv of interventions) {
    if (!iv.creneau_debut) continue;
    const d = new Date(iv.creneau_debut);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(iv);
  }

  // Calendar grid
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);
  const startDow = (firstOfMonth.getDay() + 6) % 7;
  const todayStr = new Date().toISOString().slice(0, 10);

  type Cell = {
    key: string; day: number; inMonth: boolean; iso: string; isToday: boolean;
    items: typeof interventions;
  };
  const cells: Cell[] = [];
  for (let i = 0; i < startDow; i++) {
    const d = new Date(year, month, -(startDow - i - 1));
    cells.push({ key: `pad-${i}`, day: d.getDate(), inMonth: false, iso: '', isToday: false, items: [] });
  }
  for (let d = 1; d <= lastOfMonth.getDate(); d++) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ key: iso, day: d, inMonth: true, iso, isToday: iso === todayStr, items: byDate.get(iso) ?? [] });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ key: `tail-${cells.length}`, day: 0, inMonth: false, iso: '', isToday: false, items: [] });
  }

  const prev = new Date(year, month - 1, 1);
  const next = new Date(year, month + 1, 1);

  return (
    <>
      <header className="px-6 py-4 flex items-center justify-between bg-sand border-b border-sand-border flex-shrink-0">
        <div>
          <h1 className="text-xl font-extrabold text-ink">Planning</h1>
          <p className="text-[11px] text-ink-muted mt-0.5 capitalize">{MONTHS[month]} {year} · {interventions.length} créneaux confirmés</p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/admin/planning?m=${formatMonthParam(prev.getFullYear(), prev.getMonth())}`}
            className="bg-sand-mid w-8 h-8 rounded-md text-ink-mid flex items-center justify-center hover:bg-sand-border"
          >‹</Link>
          <Link
            href={`/admin/planning?m=${formatMonthParam(next.getFullYear(), next.getMonth())}`}
            className="bg-sand-mid w-8 h-8 rounded-md text-ink-mid flex items-center justify-center hover:bg-sand-border"
          >›</Link>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 py-5">
        {/* Légende techniciens */}
        <div className="flex flex-wrap gap-3 mb-4">
          {techs.map((t) => {
            const c = techColorMap.get(t.id)!;
            return (
              <div key={t.id} className="flex items-center gap-2 text-[12px] text-ink">
                <span className="w-3 h-3 rounded-sm" style={{ background: c.bg }} />
                <span className="font-semibold">{t.prenom} {t.nom}</span>
              </div>
            );
          })}
          {techs.length === 0 && (
            <span className="text-xs text-ink-muted">Aucun technicien encodé.</span>
          )}
        </div>

        {/* Calendar */}
        <div className="bg-cream rounded-xl border border-sand-border overflow-hidden">
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
                  'p-2 min-h-[110px] ' +
                  (c.inMonth
                    ? c.isToday ? 'bg-navy-pale' : 'bg-cream'
                    : 'bg-[#FAFAF8] opacity-50')
                }
              >
                {c.inMonth && (
                  <div className={
                    'text-[11px] font-semibold mb-1.5 ' +
                    (c.isToday ? 'text-navy font-extrabold' : 'text-ink-mid')
                  }>
                    {c.day}
                  </div>
                )}
                <div className="space-y-1">
                  {c.items.map((iv) => {
                    const color = iv.technicien_id ? techColorMap.get(iv.technicien_id) ?? null : null;
                    const acpNom = iv.acp_id ? acpMap.get(iv.acp_id) ?? '—' : '—';
                    const time = new Date(iv.creneau_debut!).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
                    return (
                      <Link
                        key={iv.id}
                        href={`/admin?id=${iv.id}`}
                        title={`${time} · ${acpNom} · ${iv.type ?? ''}`}
                        className="block text-[10px] rounded px-1.5 py-1 truncate font-medium"
                        style={
                          color
                            ? { background: color.soft, color: color.bg, borderLeft: `3px solid ${color.bg}` }
                            : { background: '#EDE8DF', color: '#6B6558', borderLeft: '3px solid #DDD8CC' }
                        }
                      >
                        <span className="font-mono">{time}</span> · {acpNom}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
