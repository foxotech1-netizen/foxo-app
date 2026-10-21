'use server';

// Brouillon Odoo depuis un dossier — Server Actions du bloc « Facture Odoo ».
//
// Seule `creerBrouillonAction` écrit dans Odoo (un brouillon, jamais validé),
// et uniquement si parametres.odoo_ecriture_active vaut 'true'. Les autres
// actions lisent (Odoo ou le miroir). Admin uniquement.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from '@/lib/auth/server';
import { odooHost } from '@/lib/facturation/odoo-transport';
import {
  chercherClientsOdoo,
  creerBrouillonOdoo,
  preparerBrouillon,
  type ClientOdoo,
  type PreparationBrouillon,
  type ResultatCreation,
  type SaisieBrouillon,
} from '@/lib/facturation/odoo-brouillon';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Brouillon créé depuis FoxO, affiché dans le bloc du dossier. */
export interface BrouillonDossier {
  id: string;
  odoo_move_id: number;
  etat: 'brouillon' | 'valide' | 'supprime';
  odoo_numero: string | null;
  reference: string;
  odoo_partner_nom: string | null;
  montant_ttc: number | null;
  cree_le: string;
  cree_par: string | null;
  odoo_url: string | null;
}

export type BrouillonsDossier =
  | { ok: true; brouillons: BrouillonDossier[] }
  | { ok: false; erreur: string };

export type PreparationAction =
  | { ok: true; preparation: PreparationBrouillon }
  | { ok: false; erreur: string };

// E-mail de l'admin connecté, ou null si l'accès est refusé.
async function adminConnecte(): Promise<{ email: string | null } | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) return null;
  return { email: user.email ?? null };
}

/**
 * Brouillons créés depuis FoxO pour ce dossier. Au passage, un brouillon
 * retrouvé validé dans le miroir (même identifiant Odoo) passe à l'état
 * « valide » avec son numéro définitif.
 */
export async function brouillonsDuDossier(interventionId: string): Promise<BrouillonsDossier> {
  if (!UUID.test(interventionId)) return { ok: false, erreur: 'Dossier inconnu.' };
  if (!(await adminConnecte())) return { ok: false, erreur: 'Accès refusé.' };
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('odoo_brouillons')
    .select('id, odoo_move_id, etat, odoo_numero, reference, odoo_partner_nom, montant_ttc, cree_le, cree_par')
    .eq('intervention_id', interventionId)
    .order('cree_le', { ascending: false });
  if (error) return { ok: false, erreur: error.message };
  const rows = (data ?? []) as Omit<BrouillonDossier, 'odoo_url'>[];

  // Rapprochement avec le miroir : un brouillon validé dans Odoo y apparaît
  // avec le même identifiant.
  const enAttente = rows.filter((b) => b.etat === 'brouillon');
  if (enAttente.length > 0) {
    const { data: validees } = await admin
      .from('odoo_factures')
      .select('odoo_id, numero')
      .in('odoo_id', enAttente.map((b) => b.odoo_move_id));
    for (const v of (validees ?? []) as { odoo_id: number; numero: string | null }[]) {
      const b = enAttente.find((x) => x.odoo_move_id === v.odoo_id);
      if (!b) continue;
      b.etat = 'valide';
      b.odoo_numero = v.numero;
      await admin
        .from('odoo_brouillons')
        .update({ etat: 'valide', odoo_numero: v.numero, verifie_le: new Date().toISOString() })
        .eq('id', b.id);
    }
  }

  const hote = odooHost();
  return {
    ok: true,
    brouillons: rows.map((b) => ({
      ...b,
      odoo_url: hote ? `https://${hote}/web#id=${b.odoo_move_id}&model=account.move&view_type=form` : null,
    })),
  };
}

/** Ouvre le formulaire : lecture d'Odoo (client, catalogue), rien n'est écrit. */
export async function preparerBrouillonAction(interventionId: string): Promise<PreparationAction> {
  if (!UUID.test(interventionId)) return { ok: false, erreur: 'Dossier inconnu.' };
  const admin = await adminConnecte();
  if (!admin) return { ok: false, erreur: 'Accès refusé.' };
  try {
    return { ok: true, preparation: await preparerBrouillon(interventionId, admin.email) };
  } catch (e) {
    return { ok: false, erreur: e instanceof Error ? e.message : 'Lecture d\'Odoo impossible.' };
  }
}

/** Sélecteur de client : recherche libre dans les fiches Odoo. */
export async function chercherClientsAction(texte: string): Promise<ClientOdoo[]> {
  const admin = await adminConnecte();
  if (!admin) return [];
  try {
    return await chercherClientsOdoo(texte, admin.email);
  } catch {
    return [];
  }
}

/** Crée le brouillon dans Odoo (la seule écriture). */
export async function creerBrouillonAction(interventionId: string, saisie: SaisieBrouillon): Promise<ResultatCreation> {
  if (!UUID.test(interventionId)) return { ok: false, erreur: 'Dossier inconnu.' };
  const admin = await adminConnecte();
  if (!admin) return { ok: false, erreur: 'Accès refusé.' };
  return creerBrouillonOdoo(interventionId, saisie, admin.email);
}
