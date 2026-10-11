'use server';

// Écran « Odoo » — Server Actions. Aucune n'écrit dans Odoo ni dans les
// factures FoxO : la synchronisation remplit le miroir (odoo_factures,
// odoo_mouvements_bancaires), le réglage ne touche qu'à l'interrupteur du
// passage nocturne.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from '@/lib/auth/server';
import { synchroniserOdoo, type ResultatSync } from '@/lib/facturation/odoo-sync';

export type ResultatReglage = { ok: true } | { ok: false; erreur: string };

// E-mail de l'admin connecté, ou null si l'accès est refusé.
async function adminConnecte(): Promise<{ email: string | null } | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) return null;
  return { email: user.email ?? null };
}

/** Bouton « Synchroniser maintenant ». */
export async function lancerSynchronisationOdoo(): Promise<ResultatSync> {
  const admin = await adminConnecte();
  if (!admin) return { ok: false, erreur: 'Accès refusé.' };
  const resultat = await synchroniserOdoo('manuel', admin.email);
  revalidatePath('/admin/facturation/odoo');
  return resultat;
}

/** Allume ou éteint le passage automatique de chaque nuit. */
export async function reglerPassageNocturne(actif: boolean): Promise<ResultatReglage> {
  const admin = await adminConnecte();
  if (!admin) return { ok: false, erreur: 'Accès refusé.' };
  const { error } = await createAdminClient()
    .from('parametres')
    .upsert(
      { cle: 'odoo_lecture_active', valeur: actif ? 'true' : 'false', updated_at: new Date().toISOString() },
      { onConflict: 'cle' },
    );
  if (error) return { ok: false, erreur: error.message };
  revalidatePath('/admin/facturation/odoo');
  return { ok: true };
}
