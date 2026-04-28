import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { TECH_EMAILS } from '@/lib/auth/roles';
import type { CreneauDisponible, Utilisateur } from '@/lib/types/database';
import { PlanningCalendar } from './PlanningCalendar';
import { CreneauxClient } from './CreneauxClient';

export const dynamic = 'force-dynamic';

type Tab = 'calendar' | 'manage';

function parseMonthParam(input: string | undefined): { year: number; month: number } {
  if (input && /^\d{4}-\d{2}$/.test(input)) {
    const [y, m] = input.split('-').map(Number);
    if (m >= 1 && m <= 12) return { year: y, month: m - 1 };
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

function fmtMonth(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; tab?: string; tech?: string }>;
}) {
  const sp = await searchParams;
  const tab: Tab = sp.tab === 'manage' ? 'manage' : 'calendar';
  const { year, month } = parseMonthParam(sp.m);

  const startStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const endStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const supabase = await createClient();

  const [techRes, creneauxRes] = await Promise.all([
    supabase
      .from('utilisateurs')
      .select('id, prenom, nom, email')
      .in('email', TECH_EMAILS as unknown as string[])
      .order('prenom', { ascending: true }),
    supabase
      .from('creneaux_disponibles')
      .select('id, technicien_id, date, heure_debut, heure_fin, statut, intervention_id')
      .gte('date', startStr)
      .lte('date', endStr)
      .order('date', { ascending: true })
      .order('heure_debut', { ascending: true }),
  ]);

  const techs = (techRes.data ?? []) as Utilisateur[];
  const creneaux = (creneauxRes.data ?? []) as Pick<CreneauDisponible, 'id' | 'technicien_id' | 'date' | 'heure_debut' | 'heure_fin' | 'statut' | 'intervention_id'>[];

  const prev = new Date(year, month - 1, 1);
  const next = new Date(year, month + 1, 1);

  // Pour l'onglet "Manage" on charge sur 3 mois autour pour la liste
  const manageStart = new Date(year, month - 1, 1);
  const manageEnd = new Date(year, month + 2, 0);
  const manageStartStr = `${manageStart.getFullYear()}-${String(manageStart.getMonth() + 1).padStart(2, '0')}-${String(manageStart.getDate()).padStart(2, '0')}`;
  const manageEndStr = `${manageEnd.getFullYear()}-${String(manageEnd.getMonth() + 1).padStart(2, '0')}-${String(manageEnd.getDate()).padStart(2, '0')}`;

  let manageCreneaux: typeof creneaux = [];
  if (tab === 'manage') {
    const { data } = await supabase
      .from('creneaux_disponibles')
      .select('id, technicien_id, date, heure_debut, heure_fin, statut, intervention_id')
      .gte('date', manageStartStr)
      .lte('date', manageEndStr)
      .order('date', { ascending: true })
      .order('heure_debut', { ascending: true });
    manageCreneaux = (data ?? []) as typeof creneaux;
  }

  const tabHref = (t: Tab) => `/admin/planning?tab=${t}&m=${fmtMonth(year, month)}`;

  return (
    <>
      <header className="px-6 py-4 flex items-center justify-between bg-sand border-b border-sand-border flex-shrink-0">
        <div>
          <h1 className="text-xl font-extrabold text-ink">Planning</h1>
          <p className="text-[11px] text-ink-muted mt-0.5">
            Créneaux fermés par défaut. Crée-les explicitement dans l&apos;onglet « Gérer ».
          </p>
        </div>
      </header>

      {/* Onglets */}
      <div className="px-6 pt-4 bg-sand border-b border-sand-border flex-shrink-0">
        <div className="flex gap-1">
          <Link
            href={tabHref('calendar')}
            className={
              'px-4 py-2 rounded-t-lg text-[12px] font-bold border-b-2 ' +
              (tab === 'calendar'
                ? 'bg-cream border-navy text-navy'
                : 'border-transparent text-ink-muted hover:text-ink')
            }
          >
            Calendrier
          </Link>
          <Link
            href={tabHref('manage')}
            className={
              'px-4 py-2 rounded-t-lg text-[12px] font-bold border-b-2 ' +
              (tab === 'manage'
                ? 'bg-cream border-navy text-navy'
                : 'border-transparent text-ink-muted hover:text-ink')
            }
          >
            Gérer les disponibilités
          </Link>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-5">
        {tab === 'calendar' ? (
          <PlanningCalendar
            year={year}
            month={month}
            techs={techs}
            creneaux={creneaux}
            prevHref={`/admin/planning?tab=calendar&m=${fmtMonth(prev.getFullYear(), prev.getMonth())}`}
            nextHref={`/admin/planning?tab=calendar&m=${fmtMonth(next.getFullYear(), next.getMonth())}`}
          />
        ) : (
          <CreneauxClient
            techs={techs}
            initialCreneaux={manageCreneaux}
            initialTechId={sp.tech ?? null}
          />
        )}
      </div>
    </>
  );
}
