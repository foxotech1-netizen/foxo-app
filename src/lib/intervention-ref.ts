// Génération de la prochaine référence d'intervention au format
// {year}-{NNN} (3 chiffres min). Lit le max existant pour l'année et
// incrémente. Utilisé par planning, cron mail, et tout autre point de
// création de dossier.

import { createAdminClient } from '@/lib/supabase/admin';

export async function nextRefForYear(): Promise<string> {
  const admin = createAdminClient();
  const year = new Date().getFullYear();
  const { data } = await admin
    .from('interventions')
    .select('ref')
    .like('ref', `${year}-%`)
    .order('ref', { ascending: false })
    .limit(50);
  let next = 100;
  for (const row of (data ?? []) as { ref: string | null }[]) {
    const m = row.ref?.match(/^\d{4}-(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n + 1 > next) next = n + 1;
    }
  }
  return `${year}-${String(next).padStart(3, '0')}`;
}
