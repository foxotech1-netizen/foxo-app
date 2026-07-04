'use server';

// Server Actions du bloc « Relances automatiques » de la page Rappels.
// Déclenchement MANUEL uniquement (l'admin clique) — l'interrupteur
// parametres.relances_auto_enabled ne gate que la route cron non enregistrée.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from '@/lib/auth/server';
import {
  runRelancesAuto,
  type RelanceCandidate,
  type RunRelancesResult,
} from '@/lib/facturation/relances';

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

// Aperçu dry-run : la liste des relances dues, avec l'état pause par facture.
export async function previewRelancesDues(): Promise<
  ActionResult<{ candidates: RelanceCandidate[] }>
> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  try {
    const result = await runRelancesAuto({ dryRun: true });
    return { ok: true, data: { candidates: result.candidates } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur aperçu.' };
  }
}

// Envoi réel (limit 20) après confirmation explicite de l'admin.
export async function envoyerRelancesDues(): Promise<ActionResult<RunRelancesResult>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  try {
    const result = await runRelancesAuto({ dryRun: false, limit: 20 });
    revalidatePath('/admin/facturation/rappels');
    revalidatePath('/admin/facturation');
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur envoi.' };
  }
}

// Suspend / réactive les relances pour une facture donnée.
export async function setRelancesPause(
  factureId: string,
  pause: boolean,
): Promise<ActionResult> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  const admin = createAdminClient();
  const { error } = await admin
    .from('factures')
    .update({ relances_pause: pause, updated_at: new Date().toISOString() })
    .eq('id', factureId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/facturation/rappels');
  revalidatePath(`/admin/facturation/${factureId}`);
  return { ok: true };
}
