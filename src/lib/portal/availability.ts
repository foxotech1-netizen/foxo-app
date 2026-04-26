import { createClient } from '@/lib/supabase/server';

// Modèle simple : un créneau est une plage de 2h à heure fixe sur un jour ouvré.
// Un créneau est "réservé" si une intervention a un creneau_debut tombant
// dans cette plage. Sinon il est "libre". Pas de table dédiée pour l'instant —
// les disponibilités sont déduites de l'absence de réservation.
//
// Si tu veux à terme bloquer manuellement des créneaux (congés, déplacements),
// il faudra ajouter une table `creneaux_bloques` et l'unir à la requête.

export const SLOT_HOURS = ['08:00', '10:00', '14:00', '16:00'] as const;

export type Slot = {
  iso: string;             // ISO datetime du début du créneau
  date: string;            // YYYY-MM-DD
  hour: (typeof SLOT_HOURS)[number];
  status: 'libre' | 'reserve' | 'passe';
};

// Construit la grille des slots du mois (mer-ven, slots prédéfinis).
export async function getMonthSlots(year: number, month: number): Promise<Slot[]> {
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));

  const supabase = await createClient();
  const { data: booked } = await supabase
    .from('interventions')
    .select('creneau_debut')
    .gte('creneau_debut', start.toISOString())
    .lt('creneau_debut', end.toISOString())
    .not('creneau_debut', 'is', null);

  const reservedSet = new Set(
    (booked ?? [])
      .map((r) => (r.creneau_debut ? new Date(r.creneau_debut).toISOString() : null))
      .filter((x): x is string => x !== null),
  );

  const slots: Slot[] = [];
  const now = new Date();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let d = 1; d <= daysInMonth; d++) {
    const day = new Date(year, month, d);
    const dow = day.getDay(); // 0=dim, 6=sam
    if (dow === 0 || dow === 6) continue;
    for (const h of SLOT_HOURS) {
      const [hh, mm] = h.split(':').map(Number);
      const dt = new Date(year, month, d, hh, mm);
      const iso = dt.toISOString();
      let status: Slot['status'] = 'libre';
      if (dt < now) status = 'passe';
      else if (reservedSet.has(iso)) status = 'reserve';
      slots.push({
        iso,
        date: `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        hour: h,
        status,
      });
    }
  }
  return slots;
}

export function parseMonthParam(input: string | null | undefined): { year: number; month: number } {
  // Format attendu : "YYYY-MM"
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
