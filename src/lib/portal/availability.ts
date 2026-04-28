import { createClient } from '@/lib/supabase/server';
import type { CreneauDisponible } from '@/lib/types/database';

// Modèle : créneaux FERMÉS par défaut. Seules les lignes présentes dans
// `creneaux_disponibles` (statut='libre') apparaissent comme disponibles.
// L'admin crée explicitement les plages depuis /admin/planning (onglet
// "Gérer les disponibilités"). Les statuts 'reserve' et 'bloque' restent
// dans la table mais ne sont pas exposés au public.

export type Slot = {
  id: string;              // creneau_disponibles.id
  iso: string;             // ISO datetime du début (UTC) — pour pré-remplir le form
  date: string;            // YYYY-MM-DD
  hour: string;            // "HH:MM"
  hourEnd: string;         // "HH:MM"
  status: 'libre' | 'reserve' | 'passe';
};

// Charge les slots libres du mois pour la vue publique (RDV + portal/calendar).
// Si plusieurs techniciens ont un créneau au même horaire, on n'expose qu'un seul
// slot agrégé — le détail tech reste interne à l'admin.
export async function getMonthSlots(year: number, month: number): Promise<Slot[]> {
  const startStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const endStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const supabase = await createClient();
  const { data } = await supabase
    .from('creneaux_disponibles')
    .select('id, date, heure_debut, heure_fin, statut')
    .gte('date', startStr)
    .lte('date', endStr)
    .in('statut', ['libre', 'reserve'])
    .order('date', { ascending: true })
    .order('heure_debut', { ascending: true });

  const rows = (data ?? []) as Pick<CreneauDisponible, 'id' | 'date' | 'heure_debut' | 'heure_fin' | 'statut'>[];

  // Si plusieurs techs ont le même slot (date+heure), on garde "libre" si au
  // moins un est libre. Sinon "reserve".
  const merged = new Map<string, Slot>();
  const now = new Date();

  for (const r of rows) {
    const key = `${r.date}T${r.heure_debut}`;
    const [hh, mm] = r.heure_debut.split(':').map(Number);
    const [yy, mo, dd] = r.date.split('-').map(Number);
    const dt = new Date(yy, mo - 1, dd, hh, mm);
    let status: Slot['status'] = r.statut === 'libre' ? 'libre' : 'reserve';
    if (dt < now) status = 'passe';

    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        id: r.id,
        iso: dt.toISOString(),
        date: r.date,
        hour: r.heure_debut,
        hourEnd: r.heure_fin,
        status,
      });
    } else if (existing.status !== 'libre' && status === 'libre') {
      // Au moins un tech a ce créneau libre → bascule en libre
      merged.set(key, { ...existing, id: r.id, status: 'libre' });
    }
  }

  return Array.from(merged.values()).sort((a, b) => a.iso.localeCompare(b.iso));
}

export function parseMonthParam(input: string | null | undefined): { year: number; month: number } {
  if (input && /^\d{4}-\d{2}$/.test(input)) {
    const [y, m] = input.split('-').map(Number);
    if (m >= 1 && m <= 12) return { year: y, month: m - 1 };
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

export function formatMonthParam(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}
