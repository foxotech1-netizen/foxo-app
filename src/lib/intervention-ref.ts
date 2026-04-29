// Génération de la prochaine référence d'intervention au format
// {year}-{NNN} (3 chiffres min). Prend le MAX entre :
//   - le plus grand numéro existant en DB (table interventions)
//   - le plus grand numéro existant comme dossier dans Google Drive
//     (RAPPORTS/[YYYY]/{ref + adresse})
// puis incrémente. Drive sert de source de vérité historique pour les
// dossiers créés manuellement avant la mise en place de l'app.
//
// Si Drive n'est pas connecté ou retourne une erreur, on tombe en
// fallback sur la DB seule (silencieux).

import { createAdminClient } from '@/lib/supabase/admin';
import { getLastDriveRef } from '@/lib/google-drive';

async function getLastDbNum(year: number): Promise<number> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from('interventions')
      .select('ref')
      .like('ref', `${year}-%`)
      .order('ref', { ascending: false })
      .limit(50);
    let max = 0;
    for (const row of (data ?? []) as { ref: string | null }[]) {
      const m = row.ref?.match(/^\d{4}-(\d+)$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
    return max;
  } catch {
    return 0;
  }
}

export async function nextRefForYear(): Promise<string> {
  const year = new Date().getFullYear();

  // Lance les deux sources en parallèle (Drive peut être lent).
  const [dbMax, drive] = await Promise.all([
    getLastDbNum(year),
    getLastDriveRef().catch(() => null),
  ]);

  // Drive renvoie possiblement une année différente (ex: dernière année
  // active). On ne prend le numéro Drive que s'il concerne l'année courante.
  const driveNum = drive && drive.year === year ? drive.num : 0;

  const max = Math.max(dbMax, driveNum);
  // Démarre à 100 par convention historique FoxO si la table est vide
  // ET si Drive n'a rien sur cette année non plus.
  const next = max > 0 ? max + 1 : 100;
  return `${year}-${String(next).padStart(3, '0')}`;
}
