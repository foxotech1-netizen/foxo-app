// Diagnostic Odoo — état des lieux en LECTURE SEULE avant de construire la
// synchronisation Odoo → FoxO (factures de vente, d'achat, paiements).
//
// Ne lit que des COMPTEURS, des noms de champs et quelques pièces récentes
// réduites à leurs numéros, dates, montants et états : aucun nom de client ou
// de fournisseur, aucun libellé bancaire. N'écrit ni dans Odoo ni dans FoxO.
//
// Chaque bloc est isolé : une sonde qui échoue renvoie { erreur } sans masquer
// les autres.

import {
  isOdooReadConfigured,
  odooHost,
  odooLire,
  odooVersion,
  testerProtocole,
  type OdooMethodeLecture,
  type OdooProtocole,
} from './odoo-read';

const DEPUIS = '2026-01-01';
const TYPES_FACTURE = ['out_invoice', 'out_refund', 'in_invoice', 'in_refund'];

const CHAMPS_MOVE = [
  'name', 'ref', 'payment_reference', 'invoice_origin', 'partner_id', 'move_type', 'state',
  'payment_state', 'invoice_date', 'invoice_date_due', 'date', 'amount_untaxed', 'amount_tax',
  'amount_total', 'amount_residual', 'amount_total_signed', 'currency_id', 'company_id',
  'invoice_payments_widget', 'write_date',
];
const CHAMPS_PAIEMENT = [
  'name', 'date', 'amount', 'payment_type', 'partner_type', 'partner_id', 'state', 'memo', 'ref',
  'journal_id', 'currency_id', 'company_id', 'move_id', 'reconciled_invoice_ids',
  'reconciled_bill_ids', 'is_reconciled', 'is_matched', 'write_date',
];
const CHAMPS_LIGNE_BANQUE = [
  'date', 'amount', 'payment_ref', 'partner_id', 'partner_name', 'is_reconciled', 'journal_id',
  'company_id', 'move_id', 'statement_id', 'write_date',
];

// Champs renvoyés dans les échantillons — volontairement sans tiers ni libellé.
const ECHANTILLON_MOVE = [
  'name', 'ref', 'invoice_origin', 'payment_reference', 'invoice_date', 'invoice_date_due',
  'amount_untaxed', 'amount_total', 'amount_residual', 'payment_state', 'invoice_payments_widget',
];
const ECHANTILLON_PAIEMENT = [
  'name', 'date', 'amount', 'payment_type', 'partner_type', 'state', 'reconciled_invoice_ids',
  'reconciled_bill_ids', 'is_reconciled', 'is_matched',
];
const ECHANTILLON_LIGNE_BANQUE = ['date', 'amount', 'is_reconciled'];

type Domaine = unknown[];
type ChampsInfo = Record<string, { type?: string; selection?: [string, string][] }>;
type Ligne = Record<string, unknown>;

async function essayer<T>(fn: () => Promise<T>): Promise<T | { erreur: string }> {
  try {
    return await fn();
  } catch (e) {
    return { erreur: e instanceof Error ? e.message : String(e) };
  }
}

// Le détail des règlements d'une facture : on ne garde que date, montant,
// journal et identifiants — pas les libellés libres.
function nettoyerReglements(widget: unknown): unknown {
  if (!widget || typeof widget !== 'object') return null;
  const content = (widget as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  return content.map((c) => {
    const r = (c ?? {}) as Ligne;
    return {
      date: r.date ?? null,
      amount: r.amount ?? null,
      journal_name: r.journal_name ?? null,
      account_payment_id: r.account_payment_id ?? null,
      move_id: r.move_id ?? null,
    };
  });
}

function nettoyerMove(row: Ligne): Ligne {
  const out: Ligne = { ...row };
  if ('invoice_payments_widget' in out) {
    out.reglements = nettoyerReglements(out.invoice_payments_widget);
    delete out.invoice_payments_widget;
  }
  return out;
}

export async function runOdooDiagnostic(): Promise<Record<string, unknown>> {
  const rapport: Record<string, unknown> = {
    ok: false,
    genere_le: new Date().toISOString(),
    lecture_seule: true,
    periode_depuis: DEPUIS,
  };

  if (!isOdooReadConfigured()) {
    rapport.erreur =
      'Clés Odoo absentes côté serveur (ODOO_URL, ODOO_DB, ODOO_USER, ODOO_API_KEY dans Vercel).';
    return rapport;
  }

  rapport.configuration = { hote: odooHost(), base: (process.env.ODOO_DB ?? '').trim() };
  rapport.version = await essayer(() => odooVersion());

  // ── Quel protocole répond avec ces clés ? ──
  const testJson2 = await essayer(async () => {
    await testerProtocole('json2');
    return { ok: true };
  });
  const testJsonRpc = await essayer(async () => {
    await testerProtocole('jsonrpc');
    return { ok: true };
  });
  rapport.protocoles = { json2: testJson2, jsonrpc: testJsonRpc };

  const protocole: OdooProtocole | null =
    'ok' in testJson2 ? 'json2' : 'ok' in testJsonRpc ? 'jsonrpc' : null;
  rapport.protocole_retenu = protocole;
  if (!protocole) {
    rapport.erreur = 'Connexion refusée par Odoo — détail dans « protocoles ».';
    return rapport;
  }

  const lire = <T>(model: string, method: OdooMethodeLecture, named: Record<string, unknown>) =>
    odooLire<T>(protocole, model, method, named);
  const compter = (model: string, domain: Domaine) =>
    lire<number>(model, 'search_count', { domain });
  const champs = async (model: string, candidats: string[]): Promise<ChampsInfo> =>
    (await lire<ChampsInfo>(model, 'fields_get', {
      allfields: candidats,
      attributes: ['type', 'selection'],
    })) ?? {};
  const compterParValeur = async (
    model: string,
    base: Domaine,
    champ: string,
    valeurs: string[],
  ): Promise<Record<string, number>> =>
    Object.fromEntries(
      await Promise.all(
        valeurs.map(async (v) => [v, await compter(model, [...base, [champ, '=', v]])] as const),
      ),
    );
  const presents = (info: ChampsInfo, liste: string[]) => liste.filter((c) => c in info);
  const absents = (info: ChampsInfo, liste: string[]) => liste.filter((c) => !(c in info));

  // ── Sociétés visibles par l'utilisateur de la clé ──
  const societes = await essayer(() =>
    lire<Ligne[]>('res.company', 'search_read', { domain: [], fields: ['name'], limit: 20 }),
  );
  rapport.societes = societes;

  // ── Factures (account.move) ──
  rapport.factures = await essayer(async () => {
    const info = await champs('account.move', CHAMPS_MOVE);
    const etats = (info.payment_state?.selection ?? []).map(([v]) => v);
    const comptabilisees = (type: string): Domaine => [
      ['move_type', '=', type],
      ['state', '=', 'posted'],
      ['invoice_date', '>=', DEPUIS],
    ];
    const bloc = async (type: string) => ({
      total: await compter('account.move', comptabilisees(type)),
      par_etat_paiement: await compterParValeur('account.move', comptabilisees(type), 'payment_state', etats),
    });
    const horsComptabilise = (state: string): Domaine => [
      ['move_type', 'in', TYPES_FACTURE],
      ['state', '=', state],
      ['date', '>=', DEPUIS],
    ];

    const parSociete: Ligne[] = [];
    if (Array.isArray(societes) && societes.length > 1) {
      for (const s of societes) {
        parSociete.push({
          id: s.id,
          name: s.name,
          ventes: await compter('account.move', [...comptabilisees('out_invoice'), ['company_id', '=', s.id]]),
          achats: await compter('account.move', [...comptabilisees('in_invoice'), ['company_id', '=', s.id]]),
        });
      }
    }

    const champsEchantillon = presents(info, ECHANTILLON_MOVE);
    const echantillon = async (type: string) =>
      (
        await lire<Ligne[]>('account.move', 'search_read', {
          domain: comptabilisees(type),
          fields: champsEchantillon,
          limit: 3,
          order: 'invoice_date desc, id desc',
        })
      ).map(nettoyerMove);

    return {
      champs_absents: absents(info, CHAMPS_MOVE),
      etats_paiement_possibles: etats,
      ventes: await bloc('out_invoice'),
      notes_credit_ventes: await bloc('out_refund'),
      achats: await bloc('in_invoice'),
      notes_credit_achats: await bloc('in_refund'),
      brouillons: await compter('account.move', horsComptabilise('draft')),
      annulees: await compter('account.move', horsComptabilise('cancel')),
      par_societe: parSociete,
      echantillon_ventes: await echantillon('out_invoice'),
      echantillon_achats: await echantillon('in_invoice'),
    };
  });

  // ── Paiements enregistrés (account.payment) ──
  rapport.paiements = await essayer(async () => {
    const info = await champs('account.payment', CHAMPS_PAIEMENT);
    const etats = (info.state?.selection ?? []).map(([v]) => v);
    const base: Domaine = [['date', '>=', DEPUIS]];
    return {
      champs_absents: absents(info, CHAMPS_PAIEMENT),
      etats_possibles: etats,
      total: await compter('account.payment', base),
      recus: await compter('account.payment', [...base, ['payment_type', '=', 'inbound']]),
      envoyes: await compter('account.payment', [...base, ['payment_type', '=', 'outbound']]),
      par_etat: await compterParValeur('account.payment', base, 'state', etats),
      echantillon: await lire<Ligne[]>('account.payment', 'search_read', {
        domain: base,
        fields: presents(info, ECHANTILLON_PAIEMENT),
        limit: 3,
        order: 'date desc, id desc',
      }),
    };
  });

  // ── Mouvements bancaires (account.bank.statement.line) ──
  rapport.lignes_bancaires = await essayer(async () => {
    const info = await champs('account.bank.statement.line', CHAMPS_LIGNE_BANQUE);
    const base: Domaine = [['date', '>=', DEPUIS]];
    const rapprochement = 'is_reconciled' in info
      ? {
          rapprochees: await compter('account.bank.statement.line', [...base, ['is_reconciled', '=', true]]),
          non_rapprochees: await compter('account.bank.statement.line', [...base, ['is_reconciled', '=', false]]),
        }
      : {};
    return {
      champs_absents: absents(info, CHAMPS_LIGNE_BANQUE),
      total: await compter('account.bank.statement.line', base),
      entrees: await compter('account.bank.statement.line', [...base, ['amount', '>', 0]]),
      sorties: await compter('account.bank.statement.line', [...base, ['amount', '<', 0]]),
      ...rapprochement,
      echantillon: await lire<Ligne[]>('account.bank.statement.line', 'search_read', {
        domain: base,
        fields: presents(info, ECHANTILLON_LIGNE_BANQUE),
        limit: 3,
        order: 'date desc, id desc',
      }),
    };
  });

  rapport.ok = true;
  return rapport;
}
