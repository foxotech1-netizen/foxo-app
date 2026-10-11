import { createClient } from '@/lib/supabase/server';
import { odooHost } from '@/lib/facturation/odoo-read';
import { OdooClient, type FactureOdoo, type MouvementOdoo, type PassageOdoo } from './OdooClient';

export const dynamic = 'force-dynamic';
// L'action « Synchroniser maintenant » (segment de cette page) enchaîne
// quelques lectures Odoo espacées d'une seconde puis l'écriture du miroir.
export const maxDuration = 120;

// Le client Supabase plafonne à 1 000 lignes par lecture : on pagine.
const PAGE = 1_000;
const PAGES_MAX = 10;

const COLONNES_FACTURE =
  'id, odoo_id, sens, est_note_credit, numero, reference, tiers_nom, date_facture, date_echeance, montant_ttc, etat_paiement, reglements, date_dernier_reglement, dossier_ref, intervention_id';
const COLONNES_MOUVEMENT =
  'id, odoo_id, odoo_move_id, date_mouvement, montant, tiers_nom, communication, rapproche';

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function toutLire<T>(
  supabase: Supabase,
  table: string,
  colonnes: string,
  colonneDate: string,
): Promise<{ lignes: T[]; erreur: string | null }> {
  const lignes: T[] = [];
  for (let page = 0; page < PAGES_MAX; page += 1) {
    const { data, error } = await supabase
      .from(table)
      .select(colonnes)
      .order(colonneDate, { ascending: false, nullsFirst: false })
      .order('odoo_id', { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) return { lignes, erreur: error.message };
    const lot = (data ?? []) as unknown as T[];
    lignes.push(...lot);
    if (lot.length < PAGE) break;
  }
  return { lignes, erreur: null };
}

export default async function OdooPage() {
  const supabase = await createClient();

  const [factures, mouvements, passages, reglages] = await Promise.all([
    toutLire<FactureOdoo>(supabase, 'odoo_factures', COLONNES_FACTURE, 'date_facture'),
    toutLire<MouvementOdoo>(supabase, 'odoo_mouvements_bancaires', COLONNES_MOUVEMENT, 'date_mouvement'),
    supabase
      .from('odoo_synchronisations')
      .select('demarree_le, terminee_le, statut, erreur')
      .order('demarree_le', { ascending: false })
      .limit(10),
    supabase
      .from('parametres')
      .select('cle, valeur')
      .in('cle', ['odoo_lecture_active', 'odoo_lecture_depuis']),
  ]);

  const listePassages = (passages.data ?? []) as PassageOdoo[];
  const reglage = (cle: string): string | null =>
    ((reglages.data ?? []) as Array<{ cle: string; valeur: string | null }>)
      .find((r) => r.cle === cle)?.valeur ?? null;
  const hote = odooHost();

  return (
    <OdooClient
      factures={factures.lignes}
      mouvements={mouvements.lignes}
      dernierPassage={listePassages[0] ?? null}
      dernierPassageReussi={listePassages.find((p) => p.statut === 'ok') ?? null}
      nocturneActive={reglage('odoo_lecture_active') === 'true'}
      depuis={reglage('odoo_lecture_depuis')}
      odooUrl={hote ? `https://${hote}` : null}
      erreurChargement={factures.erreur ?? mouvements.erreur ?? passages.error?.message ?? null}
    />
  );
}
