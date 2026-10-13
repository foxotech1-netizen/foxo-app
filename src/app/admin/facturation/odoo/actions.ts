'use server';

// Écran « Odoo » — Server Actions. Aucune n'écrit dans Odoo ni dans les
// factures FoxO : la synchronisation remplit le miroir (odoo_factures,
// odoo_mouvements_bancaires), le réglage ne touche qu'à l'interrupteur du
// passage nocturne.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from '@/lib/auth/server';
import { odooHost } from '@/lib/facturation/odoo-read';
import { synchroniserOdoo, type ResultatSync } from '@/lib/facturation/odoo-sync';

export type ResultatReglage = { ok: true } | { ok: false; erreur: string };

/** Pièce Odoo affichée dans le bloc « Facture Odoo » d'un dossier. */
export interface FactureOdooDossier {
  id: string;
  odoo_id: number;
  est_note_credit: boolean;
  numero: string | null;
  date_facture: string | null;
  date_echeance: string | null;
  montant_ttc: number | null;
  montant_restant: number | null;
  etat_paiement: string;
  date_dernier_reglement: string | null;
}

export type FacturesOdooDossier =
  | { ok: true; factures: FactureOdooDossier[]; derniereSynchronisation: string | null; odooUrl: string | null }
  | { ok: false; erreur: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Bloc « Facture Odoo » d'un dossier : les pièces du miroir reliées à ce
 * dossier (lien posé par la synchronisation : numéro de facture = numéro de
 * dossier, référence en secours). Lecture sous RLS : réservée aux admins.
 */
export async function facturesOdooDuDossier(interventionId: string): Promise<FacturesOdooDossier> {
  if (!UUID.test(interventionId)) return { ok: false, erreur: 'Dossier inconnu.' };
  const supabase = await createClient();
  const [factures, passage] = await Promise.all([
    supabase
      .from('odoo_factures')
      .select('id, odoo_id, est_note_credit, numero, date_facture, date_echeance, montant_ttc, montant_restant, etat_paiement, date_dernier_reglement')
      .eq('intervention_id', interventionId)
      .order('date_facture', { ascending: true, nullsFirst: false })
      .order('odoo_id', { ascending: true }),
    supabase
      .from('odoo_synchronisations')
      .select('terminee_le')
      .eq('statut', 'ok')
      .order('demarree_le', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (factures.error) return { ok: false, erreur: factures.error.message };
  const hote = odooHost();
  return {
    ok: true,
    factures: (factures.data ?? []) as FactureOdooDossier[],
    derniereSynchronisation: (passage.data as { terminee_le: string | null } | null)?.terminee_le ?? null,
    odooUrl: hote ? `https://${hote}` : null,
  };
}

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
