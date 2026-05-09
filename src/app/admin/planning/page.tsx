import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { TECH_EMAILS } from '@/lib/auth/roles';
import { loadTokens } from '@/lib/google-auth';
import type { CreneauDisponible, ParticulierContact, Utilisateur } from '@/lib/types/database';
import { PlanningCalendar } from './PlanningCalendar';
import { WeeklyDispoGrid } from './WeeklyDispoGrid';

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

  // On élargit la fenêtre fetch ±10 jours autour du mois pour que la
  // vue Semaine ait toujours des données quand la semaine déborde
  // sur le mois précédent / suivant (ex. lun 30 mars → dim 5 avril).
  const fetchStart = new Date(year, month, 1);
  fetchStart.setDate(fetchStart.getDate() - 10);
  const fetchEnd = new Date(year, month + 1, 0);
  fetchEnd.setDate(fetchEnd.getDate() + 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  const startStr = `${fetchStart.getFullYear()}-${pad(fetchStart.getMonth() + 1)}-${pad(fetchStart.getDate())}`;
  const endStr = `${fetchEnd.getFullYear()}-${pad(fetchEnd.getMonth() + 1)}-${pad(fetchEnd.getDate())}`;

  const supabase = await createClient();

  const [techRes, creneauxRes, paramRes] = await Promise.all([
    supabase
      .from('utilisateurs')
      .select('id, prenom, nom, email, couleur')
      .in('email', TECH_EMAILS as unknown as string[])
      .order('prenom', { ascending: true }),
    supabase
      .from('creneaux_disponibles')
      .select('id, technicien_id, date, heure_debut, heure_fin, statut, intervention_id, intervention:interventions(color, ref, particulier_contact)')
      .gte('date', startStr)
      .lte('date', endStr)
      .order('date', { ascending: true })
      .order('heure_debut', { ascending: true }),
    // Paramètres couleurs planning — fallback aux défauts si absent
    supabase
      .from('parametres')
      .select('cle, valeur')
      .in('cle', [
        'planning_couleur_libre',
        'planning_couleur_reserve',
        'planning_couleur_bloque',
        'planning_couleur_google',
        'planning_couleur_foxo_importe',
      ]),
  ]);

  const techs = (techRes.data ?? []) as Utilisateur[];

  // Couleurs planning — fallback aux défauts si la migration 2026-05-21
  // n'est pas appliquée OU si un paramètre est absent.
  const paramMap = new Map<string, string>();
  for (const p of (paramRes.data ?? []) as { cle: string; valeur: string | null }[]) {
    if (p.valeur) paramMap.set(p.cle, p.valeur);
  }
  const planningColors = {
    libre: paramMap.get('planning_couleur_libre') ?? '#1F6B45',
    reserve: paramMap.get('planning_couleur_reserve') ?? '#1B3A6B',
    bloque: paramMap.get('planning_couleur_bloque') ?? '#6B7280',
    google: paramMap.get('planning_couleur_google') ?? '#4338CA',
    foxo_importe: paramMap.get('planning_couleur_foxo_importe') ?? '#7C3AED',
  };
  // Le join `intervention:interventions(color)` renvoie un tableau
  // (pattern Supabase pour les relations) — on prend le premier élément
  // ou null. On l'aplatit en `intervention_color` pour éviter d'exposer
  // la forme join au composant client.
  type IvRel = { color: string | null; ref: string | null; particulier_contact: ParticulierContact | null };
  type CreneauJoinRow = Pick<CreneauDisponible, 'id' | 'technicien_id' | 'date' | 'heure_debut' | 'heure_fin' | 'statut' | 'intervention_id'>
    & { intervention: IvRel[] | IvRel | null };
  const creneaux = ((creneauxRes.data ?? []) as unknown as CreneauJoinRow[]).map((c) => {
    const ivRel = Array.isArray(c.intervention) ? c.intervention[0] : c.intervention;
    const pc = ivRel?.particulier_contact ?? null;
    const clientName = pc
      ? [pc.prenom, pc.nom].filter(Boolean).join(' ').trim() || null
      : null;
    return {
      id: c.id,
      technicien_id: c.technicien_id,
      date: c.date,
      heure_debut: c.heure_debut,
      heure_fin: c.heure_fin,
      statut: c.statut,
      intervention_id: c.intervention_id,
      intervention_color: ivRel?.color ?? null,
      intervention_ref: ivRel?.ref ?? null,
      client_name: clientName,
    };
  });

  // Statut Google — utilisé pour activer/désactiver le toggle
  // "Afficher Google Calendar" dans PlanningCalendar.
  const tokens = await loadTokens();
  const googleConnected = Boolean(tokens?.access_token && tokens?.refresh_token);

  const prev = new Date(year, month - 1, 1);
  const next = new Date(year, month + 1, 1);

  // L'onglet "Gérer" utilise WeeklyDispoGrid qui charge ses dispos en
  // interne via l'API — pas de pré-fetch nécessaire ici.

  const tabHref = (t: Tab) => `/admin/planning?tab=${t}&m=${fmtMonth(year, month)}`;

  return (
    <>
      <div className="mb-4 pb-3.5 border-b border-[var(--color-sand-border)]">
        <h1 className="fxs-page-title mb-1">
          <span>Planning</span>
        </h1>
        <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
          <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
          Créneaux fermés par défaut. Crée-les explicitement dans l&apos;onglet « Gérer »
        </div>
      </div>

      {/* Onglets */}
      <div className="mb-4">
        <div className="flex gap-1 border-b border-[var(--color-sand-border)]">
          <Link
            href={tabHref('calendar')}
            className={
              'px-4 py-2 rounded-t-lg text-[12px] font-medium border-b-2 -mb-px ' +
              (tab === 'calendar'
                ? 'bg-[var(--color-cream)] border-[var(--color-navy)] text-[var(--color-navy)]'
                : 'border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]')
            }
          >
            Calendrier
          </Link>
          <Link
            href={tabHref('manage')}
            className={
              'px-4 py-2 rounded-t-lg text-[12px] font-medium border-b-2 -mb-px ' +
              (tab === 'manage'
                ? 'bg-[var(--color-cream)] border-[var(--color-navy)] text-[var(--color-navy)]'
                : 'border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]')
            }
          >
            Gérer les disponibilités
          </Link>
        </div>
      </div>

      <div>
        {tab === 'calendar' ? (
          <PlanningCalendar
            year={year}
            month={month}
            techs={techs}
            creneaux={creneaux}
            googleConnected={googleConnected}
            planningColors={planningColors}
            prevHref={`/admin/planning?tab=calendar&m=${fmtMonth(prev.getFullYear(), prev.getMonth())}`}
            nextHref={`/admin/planning?tab=calendar&m=${fmtMonth(next.getFullYear(), next.getMonth())}`}
          />
        ) : (
          <WeeklyDispoGrid techs={techs} />
        )}
      </div>
    </>
  );
}
