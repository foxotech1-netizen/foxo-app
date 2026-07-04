'use server';

// Server Actions du barème kilométrique (table bareme_km) — garde admin.
// Les taux SPF sont saisis manuellement à chaque publication officielle :
// aucun taux n'est codé en dur (loi doc 02).

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from '@/lib/auth/server';

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

async function assertAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return { ok: false, error: 'Accès refusé.' };
  }
  return { ok: true };
}

export async function addTauxKm(
  dateDebut: string,
  tauxEurKm: number,
): Promise<ActionResult<{ id: string }>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateDebut)) {
    return { ok: false, error: 'Date de début invalide (YYYY-MM-DD).' };
  }
  if (!Number.isFinite(tauxEurKm) || tauxEurKm <= 0 || tauxEurKm >= 10) {
    return { ok: false, error: 'Taux €/km invalide (attendu entre 0 et 10).' };
  }

  const admin = createAdminClient();
  const { data: societe } = await admin
    .from('societes')
    .select('id')
    .eq('actif', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const { data, error } = await admin
    .from('bareme_km')
    .insert({
      societe_id: (societe?.id as string | undefined) ?? null,
      date_debut: dateDebut,
      taux_eur_km: tauxEurKm,
      actif: true,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Erreur création.' };

  revalidatePath('/admin/parametres');
  return { ok: true, data: { id: data.id as string } };
}

export async function setTauxKmActif(id: string, actif: boolean): Promise<ActionResult> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  const admin = createAdminClient();
  const { error } = await admin
    .from('bareme_km')
    .update({ actif })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/parametres');
  return { ok: true };
}
