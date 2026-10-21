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
import { lireJournalise, ouvrirContexte } from '@/lib/facturation/odoo-write';
import {
  chercherClientsOdoo,
  creerBrouillonOdoo,
  paiementBrouillon,
  preparerBrouillon,
  type ClientOdoo,
  type PaiementBrouillon,
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
  communication: string | null;
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
 * Brouillons créés depuis FoxO pour ce dossier. Au passage, l'état des
 * brouillons en attente est rafraîchi : d'abord par le miroir (une pièce
 * validée y apparaît avec le même identifiant), puis par une lecture directe
 * d'Odoo pour ceux qui restent — supprimé dans Odoo → « supprime », validé
 * → « valide » avec son numéro. Si Odoo ne répond pas, l'état connu est gardé.
 */
export async function brouillonsDuDossier(interventionId: string): Promise<BrouillonsDossier> {
  if (!UUID.test(interventionId)) return { ok: false, erreur: 'Dossier inconnu.' };
  const connecte = await adminConnecte();
  if (!connecte) return { ok: false, erreur: 'Accès refusé.' };
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('odoo_brouillons')
    .select('id, odoo_move_id, etat, odoo_numero, reference, communication, odoo_partner_nom, montant_ttc, cree_le, cree_par')
    .eq('intervention_id', interventionId)
    .order('cree_le', { ascending: false });
  if (error) return { ok: false, erreur: error.message };
  const rows = (data ?? []) as Omit<BrouillonDossier, 'odoo_url'>[];
  const maintenant = new Date().toISOString();

  // 1. Rapprochement avec le miroir.
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
        .update({ etat: 'valide', odoo_numero: v.numero, verifie_le: maintenant })
        .eq('id', b.id);
    }
  }

  // 2. Lecture directe d'Odoo pour ceux qui restent en attente (un appel).
  const restants = rows.filter((b) => b.etat === 'brouillon');
  if (restants.length > 0) {
    try {
      const ctx = await ouvrirContexte({ interventionId, appelePar: connecte.email });
      const pieces = await lireJournalise<Array<{ id: number; state?: string; name?: string | false }>>(
        ctx,
        'account.move',
        'search_read',
        { domain: [['id', 'in', restants.map((b) => b.odoo_move_id)]], fields: ['state', 'name'], limit: restants.length },
        { quoi: 'état des brouillons en attente', ids: restants.map((b) => b.odoo_move_id) },
      );
      for (const b of restants) {
        const piece = pieces.find((p) => p.id === b.odoo_move_id);
        let etat: BrouillonDossier['etat'] = 'brouillon';
        let numero: string | null = b.odoo_numero;
        if (!piece || piece.state === 'cancel') etat = 'supprime';
        else if (piece.state === 'posted') { etat = 'valide'; numero = typeof piece.name === 'string' ? piece.name : null; }
        b.etat = etat;
        b.odoo_numero = numero;
        await admin
          .from('odoo_brouillons')
          .update({ etat, odoo_numero: numero, verifie_le: maintenant })
          .eq('id', b.id);
      }
    } catch {
      // Odoo injoignable : on garde l'état connu, le bloc reste utilisable.
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

/** QR de paiement d'un brouillon en attente (paiement sur place). */
export async function qrPaiementAction(brouillonId: string): Promise<{ ok: true; paiement: PaiementBrouillon } | { ok: false; erreur: string }> {
  if (!UUID.test(brouillonId)) return { ok: false, erreur: 'Brouillon inconnu.' };
  if (!(await adminConnecte())) return { ok: false, erreur: 'Accès refusé.' };
  const { data } = await createAdminClient()
    .from('odoo_brouillons')
    .select('communication, montant_ttc')
    .eq('id', brouillonId)
    .maybeSingle();
  const b = data as { communication: string | null; montant_ttc: number | null } | null;
  if (!b || !b.communication || typeof b.montant_ttc !== 'number') {
    return { ok: false, erreur: 'Pas de communication structurée pour ce brouillon.' };
  }
  try {
    return { ok: true, paiement: await paiementBrouillon(b.montant_ttc, b.communication) };
  } catch (e) {
    return { ok: false, erreur: e instanceof Error ? e.message : 'QR impossible.' };
  }
}

/** Crée le brouillon dans Odoo (la seule écriture). */
export async function creerBrouillonAction(interventionId: string, saisie: SaisieBrouillon): Promise<ResultatCreation> {
  if (!UUID.test(interventionId)) return { ok: false, erreur: 'Dossier inconnu.' };
  const admin = await adminConnecte();
  if (!admin) return { ok: false, erreur: 'Accès refusé.' };
  return creerBrouillonOdoo(interventionId, saisie, admin.email);
}
