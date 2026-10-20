// Diagnostic Odoo « volet écriture » — état des lieux en LECTURE SEULE avant
// de créer des factures de vente en BROUILLON dans Odoo depuis FoxO.
//
// Question posée à Odoo : « que faut-il fournir pour qu'une facture de vente
// brouillon soit acceptée et ressemble à celles que Foxo encode à la main ? »
// Réponse ramenée en un seul JSON : champs disponibles et obligatoires des
// modèles concernés, journaux de vente, taxes de vente, comptes de produits,
// conditions de paiement, produits, valeurs par défaut d'une facture neuve,
// et quelques factures récentes avec leurs lignes et leurs tiers, pour copier
// le patron réel.
//
// Lecture seule par construction (odoo-read.ts : search_read, search_count,
// fields_get, default_get). N'écrit ni dans Odoo ni dans FoxO. Ne dépend pas
// de l'interrupteur parametres.odoo_sync_enabled.
//
// Contrairement au premier diagnostic, les exemples contiennent les noms et
// adresses des tiers : la route est réservée aux admins et ces données sont
// celles de FoxO. Une quinzaine d'appels, espacés d'une seconde (cadence
// Odoo en ligne), donc 20 à 30 s au total.

import { createAdminClient } from '@/lib/supabase/admin';
import {
  isOdooReadConfigured,
  odooHost,
  odooLire,
  odooNombreAppels,
  odooVersion,
  testerProtocole,
  type OdooMethodeLecture,
  type OdooProtocole,
} from './odoo-read';

const DEPUIS = '2026-01-01';
const NB_EXEMPLES = 3;
const LIMITE_LISTE = 50;

type Ligne = Record<string, unknown>;
interface ChampInfo {
  string?: string;
  type?: string;
  required?: boolean;
  readonly?: boolean;
  relation?: string;
  selection?: [string, string][];
}
type ChampsInfo = Record<string, ChampInfo>;

// Champs que l'on pense devoir remplir (ou lire) sur chaque modèle. Ceux qui
// n'existent pas dans cette version d'Odoo ressortent marqués « absent ».
const CANDIDATS_MOVE = [
  'name', 'sequence_prefix', 'sequence_number', 'ref', 'payment_reference', 'invoice_origin',
  'narration', 'move_type', 'state', 'partner_id', 'partner_shipping_id', 'commercial_partner_id',
  'journal_id', 'company_id', 'currency_id', 'date', 'invoice_date', 'invoice_date_due',
  'invoice_payment_term_id', 'fiscal_position_id', 'invoice_user_id', 'partner_bank_id',
  'team_id', 'invoice_line_ids', 'line_ids', 'amount_untaxed', 'amount_tax', 'amount_total',
  'payment_state', 'delivery_date', 'invoice_incoterm_id', 'to_check', 'auto_post',
];
const CANDIDATS_LIGNE = [
  'move_id', 'sequence', 'display_type', 'name', 'product_id', 'product_uom_id', 'quantity',
  'price_unit', 'discount', 'tax_ids', 'account_id', 'analytic_distribution', 'price_subtotal',
  'price_total', 'currency_id', 'company_id', 'partner_id',
];
const CANDIDATS_TIERS = [
  'name', 'display_name', 'is_company', 'company_type', 'parent_id', 'commercial_partner_id',
  'ref', 'vat', 'street', 'street2', 'zip', 'city', 'country_id', 'email', 'phone', 'mobile',
  'lang', 'customer_rank', 'supplier_rank', 'property_payment_term_id',
  'property_account_position_id', 'property_account_receivable_id', 'company_id', 'active',
];
const CANDIDATS_JOURNAL = [
  'name', 'code', 'type', 'company_id', 'currency_id', 'default_account_id',
  'invoice_reference_type', 'invoice_reference_model', 'active', 'sequence',
];
const CANDIDATS_TAXE = [
  'name', 'description', 'amount', 'amount_type', 'type_tax_use', 'price_include',
  'price_include_override', 'active', 'tax_group_id', 'country_id', 'company_id',
];
const CANDIDATS_COMPTE = [
  'code', 'name', 'account_type', 'company_id', 'company_ids', 'deprecated', 'active',
];
const CANDIDATS_TERME = ['name', 'company_id', 'note', 'active'];
const CANDIDATS_PRODUIT = [
  'name', 'default_code', 'list_price', 'taxes_id', 'property_account_income_id', 'type',
  'sale_ok', 'uom_id', 'company_id', 'active',
];
const CANDIDATS_SOCIETE = [
  'name', 'currency_id', 'country_id', 'vat', 'account_sale_tax_id', 'account_fiscal_country_id',
  'invoice_terms',
];
const CANDIDATS_UTILISATEUR = ['company_id', 'company_ids', 'tz', 'lang', 'active'];

// Valeurs par défaut demandées à Odoo pour une facture de vente neuve.
const DEFAUTS_MOVE = [
  'journal_id', 'company_id', 'currency_id', 'invoice_date', 'date', 'invoice_payment_term_id',
  'invoice_user_id', 'move_type', 'state', 'fiscal_position_id', 'partner_bank_id',
];

async function essayer<T>(fn: () => Promise<T>): Promise<T | { erreur: string }> {
  try {
    return await fn();
  } catch (e) {
    return { erreur: e instanceof Error ? e.message : String(e) };
  }
}

// Un lien Odoo arrive sous la forme d'un identifiant, d'une paire [id, nom]
// ou d'un objet { id, … } selon le protocole.
function idDe(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (Array.isArray(v) && typeof v[0] === 'number') return v[0];
  if (v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'number') {
    return (v as { id: number }).id;
  }
  return null;
}

function idsDe(lignes: Ligne[], champ: string): number[] {
  const ids = new Set<number>();
  for (const l of lignes) {
    const id = idDe(l[champ]);
    if (id != null) ids.add(id);
  }
  return [...ids];
}

// Société Odoo lue par le miroir (réglage posé par la migration 2026-10-11) ;
// 1 à défaut.
async function societeOdoo(): Promise<number> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from('parametres')
      .select('valeur')
      .eq('cle', 'odoo_lecture_societe_id')
      .maybeSingle();
    const n = Number(data?.valeur);
    return Number.isInteger(n) && n > 0 ? n : 1;
  } catch {
    return 1;
  }
}

export async function runOdooDiagnosticEcriture(): Promise<Record<string, unknown>> {
  const debut = Date.now();
  const appelsAvant = odooNombreAppels();
  const rapport: Record<string, unknown> = {
    ok: false,
    volet: 'ecriture',
    genere_le: new Date().toISOString(),
    lecture_seule: true,
    periode_depuis: DEPUIS,
  };
  const clore = (): Record<string, unknown> => {
    rapport.nb_appels = odooNombreAppels() - appelsAvant;
    rapport.duree_ms = Date.now() - debut;
    return rapport;
  };

  if (!isOdooReadConfigured()) {
    rapport.erreur =
      'Clés Odoo absentes côté serveur (ODOO_URL, ODOO_DB, ODOO_USER, ODOO_API_KEY dans Vercel).';
    return clore();
  }

  const societe = await societeOdoo();
  rapport.configuration = {
    hote: odooHost(),
    base: (process.env.ODOO_DB ?? '').trim(),
    societe_odoo: societe,
  };
  rapport.version = await essayer(() => odooVersion());

  // ── Protocole : JSON-2 d'abord, JSON-RPC en repli. ──
  const testJson2 = await essayer(async () => {
    await testerProtocole('json2');
    return { ok: true };
  });
  const testJsonRpc =
    'ok' in testJson2
      ? { non_teste: true }
      : await essayer(async () => {
          await testerProtocole('jsonrpc');
          return { ok: true };
        });
  rapport.protocoles = { json2: testJson2, jsonrpc: testJsonRpc };
  const protocole: OdooProtocole | null =
    'ok' in testJson2 ? 'json2' : 'ok' in testJsonRpc ? 'jsonrpc' : null;
  rapport.protocole_retenu = protocole;
  if (!protocole) {
    rapport.erreur = 'Connexion refusée par Odoo — détail dans « protocoles ».';
    return clore();
  }

  const lire = <T>(model: string, method: OdooMethodeLecture, named: Record<string, unknown>) =>
    odooLire<T>(protocole, model, method, named);

  // Inventaire d'un modèle en UN appel : tous les champs, dont on ne garde
  // que les candidats (détaillés) et la liste des champs obligatoires.
  const inventaires = new Map<string, ChampsInfo>();
  const inventaire = async (model: string, candidats: string[]) => {
    const tous =
      (await lire<ChampsInfo>(model, 'fields_get', {
        attributes: ['string', 'type', 'required', 'readonly', 'relation', 'selection'],
      })) ?? {};
    inventaires.set(model, tous);
    const champs: Record<string, ChampInfo | 'absent'> = {};
    for (const c of candidats) champs[c] = c in tous ? tous[c] : 'absent';
    const obligatoires = Object.entries(tous)
      .filter(([, info]) => info.required === true)
      .map(([nom, info]) => ({ champ: nom, libelle: info.string ?? null, type: info.type ?? null }));
    return { nb_champs_total: Object.keys(tous).length, obligatoires, candidats: champs };
  };
  // Ne demander à search_read que des champs qui existent (sinon Odoo refuse
  // tout l'appel). Un modèle non inventorié est inventorié à la volée.
  const presents = async (model: string, candidats: string[]): Promise<string[]> => {
    if (!inventaires.has(model)) {
      inventaires.set(
        model,
        (await lire<ChampsInfo>(model, 'fields_get', { attributes: ['type'] })) ?? {},
      );
    }
    const tous = inventaires.get(model) ?? {};
    return candidats.filter((c) => c in tous);
  };
  const lister = async (
    model: string,
    domain: unknown[],
    candidats: string[],
    options: { limit?: number; order?: string } = {},
  ): Promise<Ligne[]> => {
    const fields = await presents(model, candidats);
    return lire<Ligne[]>(model, 'search_read', {
      domain,
      fields,
      limit: options.limit ?? LIMITE_LISTE,
      ...(options.order ? { order: options.order } : {}),
    });
  };

  // ── 1. Modèles : champs disponibles et obligatoires ──
  rapport.modele_facture = await essayer(() => inventaire('account.move', CANDIDATS_MOVE));
  rapport.modele_ligne = await essayer(() => inventaire('account.move.line', CANDIDATS_LIGNE));
  rapport.modele_tiers = await essayer(() => inventaire('res.partner', CANDIDATS_TIERS));

  // ── 2. Contexte comptable de la société ──
  rapport.utilisateur_api = await essayer(() =>
    lister('res.users', [['login', '=', (process.env.ODOO_USER ?? '').trim()]], CANDIDATS_UTILISATEUR, {
      limit: 1,
    }),
  );
  rapport.societe = await essayer(() =>
    lister('res.company', [['id', '=', societe]], CANDIDATS_SOCIETE, { limit: 1 }),
  );
  rapport.journaux_vente = await essayer(() =>
    lister('account.journal', [['type', '=', 'sale'], ['company_id', '=', societe]], CANDIDATS_JOURNAL),
  );
  rapport.taxes_vente = await essayer(() =>
    lister('account.tax', [['type_tax_use', '=', 'sale'], ['company_id', '=', societe]], CANDIDATS_TAXE),
  );
  rapport.comptes_produits = await essayer(() =>
    lister('account.account', [['account_type', 'in', ['income', 'income_other']]], CANDIDATS_COMPTE, {
      order: 'code',
    }),
  );
  rapport.conditions_paiement = await essayer(() =>
    lister('account.payment.term', [], CANDIDATS_TERME, { limit: 20 }),
  );
  rapport.produits_vendables = await essayer(() =>
    lister('product.product', [['sale_ok', '=', true]], CANDIDATS_PRODUIT, { limit: 20 }),
  );

  // ── 3. Valeurs par défaut d'une facture de vente neuve ──
  rapport.defauts_facture_neuve = await essayer(() =>
    lire<Ligne>('account.move', 'default_get', {
      fields_list: DEFAUTS_MOVE,
      context: { default_move_type: 'out_invoice', allowed_company_ids: [societe] },
    }),
  );

  // ── 4. Factures récentes validées : le patron réel, avec lignes et tiers ──
  const exemples = await essayer(() =>
    lister(
      'account.move',
      [
        ['company_id', '=', societe],
        ['move_type', '=', 'out_invoice'],
        ['state', '=', 'posted'],
        ['invoice_date', '>=', DEPUIS],
      ],
      CANDIDATS_MOVE,
      { limit: NB_EXEMPLES, order: 'invoice_date desc, id desc' },
    ),
  );
  rapport.exemples_factures = exemples;
  if (Array.isArray(exemples) && exemples.length > 0) {
    const moveIds = idsDe(exemples, 'id');
    const partnerIds = idsDe(exemples, 'partner_id');
    rapport.exemples_lignes = await essayer(() =>
      lister('account.move.line', [['move_id', 'in', moveIds]], CANDIDATS_LIGNE, {
        limit: 200,
        order: 'move_id, sequence, id',
      }),
    );
    rapport.exemples_tiers = await essayer(() =>
      lister('res.partner', [['id', 'in', partnerIds]], CANDIDATS_TIERS, { limit: NB_EXEMPLES }),
    );
  }

  // ── 5. Brouillons de vente déjà présents (ne pas marcher dessus) ──
  rapport.brouillons_vente = await essayer(() =>
    lister(
      'account.move',
      [['company_id', '=', societe], ['move_type', '=', 'out_invoice'], ['state', '=', 'draft']],
      ['name', 'ref', 'invoice_date', 'amount_total', 'partner_id', 'create_date'],
      { limit: 10, order: 'id desc' },
    ),
  );

  rapport.ok = true;
  return clore();
}
