'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';
import { runCheckMails } from '@/lib/cron/check-mails';

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

async function assertAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return { ok: false, error: 'Accès refusé.' };
  }
  return { ok: true };
}

// "Vérifier maintenant" → exécute le cron côté serveur (sans exposer
// CRON_SECRET au client). Le toggle parametres.mail_auto_analyse n'est
// PAS contrôlé ici : l'admin a explicitement cliqué.
export async function triggerCheckMailsNow(): Promise<ActionResult<{
  processed: number; created: number; labeled_lu: number; skipped: number; errors: number;
}>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  try {
    const result = await runCheckMails(false);
    revalidatePath('/admin');
    revalidatePath('/admin/parametres');
    return {
      ok: true,
      data: {
        processed: result.processed,
        created: result.created,
        labeled_lu: result.labeled_lu,
        skipped: result.skipped,
        errors: result.errors,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur inconnue' };
  }
}

// Lit parametres.mail_last_check (pour rafraîchir l'UI après le clic).
export async function getMailLastCheck(): Promise<ActionResult<{ value: string | null }>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from('parametres')
      .select('valeur')
      .eq('cle', 'mail_last_check')
      .maybeSingle();
    return { ok: true, data: { value: data?.valeur ?? null } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur inconnue' };
  }
}
