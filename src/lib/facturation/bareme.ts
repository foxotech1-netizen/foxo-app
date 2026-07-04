// Barème kilométrique (taux SPF) — paramétrable dans /admin/parametres,
// table bareme_km. AUCUN taux codé en dur (loi doc 02) : si aucun taux
// n'est configuré pour la date demandée, on renvoie null et l'appelant
// affiche un message clair.

import { createAdminClient } from '@/lib/supabase/admin';
import type { BaremeKm } from '@/lib/types/database';

/**
 * Taux €/km applicable à une date de dépense : le taux ACTIF dont la
 * date_debut est la plus récente ≤ dateDepense. null si aucun.
 */
export async function getTauxKm(dateDepense: string): Promise<BaremeKm | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateDepense)) return null;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('bareme_km')
    .select('*')
    .eq('actif', true)
    .lte('date_debut', dateDepense)
    .order('date_debut', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as BaremeKm;
  return Number.isFinite(Number(row.taux_eur_km)) && Number(row.taux_eur_km) > 0 ? row : null;
}
