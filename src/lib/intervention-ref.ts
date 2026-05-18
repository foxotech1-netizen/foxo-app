import { createAdminClient } from '@/lib/supabase/admin';
import { listDriveFolderNumbers } from '@/lib/drive/create-intervention-folder';

/** Numéro de départ si DB et Drive sont vides pour l'année. */
const START_AT = 100;

/**
 * Source de vérité unique pour le prochain numéro d'intervention.
 *
 * Stratégie : MAX(DB sans soft-deletes, Drive) + 1, filtré strictement sur refs numériques `{year}-N`.
 * Démarre à 100 si tout est vide. Les refs alphanumériques (ex. 2026-RMIY9) sont ignorées.
 *
 * Race : si deux appels concurrents tombent sur le même ref, l'INSERT déclenche 23505 ;
 * chaque caller doit retry une fois.
 */
export async function nextRefForYear(year: number = new Date().getFullYear()): Promise<string> {
  const yearStr = String(year);
  const [dbMax, driveMax] = await Promise.all([
    fetchMaxFromDb(yearStr),
    fetchMaxFromDrive(yearStr),
  ]);
  const max = Math.max(dbMax, driveMax, START_AT - 1);
  return `${yearStr}-${max + 1}`;
}

async function fetchMaxFromDb(yearStr: string): Promise<number> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('interventions')
    .select('ref')
    .like('ref', `${yearStr}-%`)
    .is('deleted_at', null);
  if (error || !data) {
    console.error('[nextRefForYear] DB scan failed:', error);
    return 0;
  }
  const re = new RegExp(`^${yearStr}-(\\d+)$`);
  let max = 0;
  for (const row of data) {
    const m = row.ref?.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return max;
}

async function fetchMaxFromDrive(yearStr: string): Promise<number> {
  try {
    const numbers = await listDriveFolderNumbers(yearStr);
    return numbers.length > 0 ? Math.max(...numbers) : 0;
  } catch (err) {
    console.error('[nextRefForYear] Drive scan failed, DB-only fallback:', err);
    return 0;
  }
}
