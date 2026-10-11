// Diagnostic Odoo — état des lieux en LECTURE SEULE avant de construire la
// synchronisation Odoo → FoxO (factures de vente, d'achat, paiements).
//
// Ne restitue que des COMPTEURS, des noms de champs et quelques pièces
// récentes réduites à leurs numéros, dates, montants et états : aucun nom de
// client ou de fournisseur, aucun libellé bancaire. N'écrit ni dans Odoo ni
// dans FoxO.
//
// Odoo en ligne n'accepte qu'un appel par seconde (cf. odoo-read.ts) : chaque
// bloc ramène ses lignes en UNE lecture légère puis compte ici, au lieu de
// multiplier les comptages côté Odoo. Une quinzaine d'appels au total.
//
// Chaque bloc est isolé : une sonde qui échoue renvoie { erreur } sans masquer
// les autres.

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
const TYPES_FACTURE = ['out_invoice', 'out_refund', 'in_invoice', 'in_refund'];
const ETATS_REGLES = ['paid', 'in_payment', 'partial'];
// Lecture paginée : 1 000 lignes par appel, 5 appels au plus par bloc.
const PAGE = 1_000;
const PAGES_MAX = 5;

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

// Champs lus en masse pour compter — légers, sans tiers ni libellé.
const COMPTAGE_MOVE = ['move_type', 'state', 'payment_state', 'invoice_date', 'date', 'company_id'];
const COMPTAGE_PAIEMENT = ['payment_type', 'state', 'date', 'company_id'];
const COMPTAGE_LIGNE_BANQUE = ['date', 'amount', 'is_reconciled', 'company_id'];

// Champs renvoyés dans les échantillons — volontairement sans tiers ni libellé.
const ECHANTILLON_MOVE = [
  'name', 'ref', 'invoice_origin', 'payment_reference', 'invoice_date', 'invoice_date_due',
  'amount_untaxed', 'amount_total', 'amount_residual', 'payment_state', 'invoice_payments_widget',
];
const ECHANTILLON_PAIEMENT = [
  'name', 'date', 'amount', 'payment_type', 'partner_type', 'state', 'reconciled_invoice_ids',
  'reconciled_bill_ids', 'is_reconciled', 'is_matched',
];

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

function texte(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

// Un lien Odoo (société, journal…) arrive sous la forme d'un identifiant, d'une
// paire [id, nom] ou d'un objet { id, … } selon le protocole.
function idDe(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (Array.isArray(v) && typeof v[0] === 'number') return v[0];
  if (v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'number') {
    return (v as { id: number }).id;
  }
  return null;
}

function incrementer(compteurs: Record<string, number>, cle: string | null): void {
  const k = cle ?? '(vide)';
  compteurs[k] = (compteurs[k] ?? 0) + 1;
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
  const debut = Date.now();
  const appelsAvant = odooNombreAppels();
  const rapport: Record<string, unknown> = {
    ok: false,
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

  rapport.configuration = { hote: odooHost(), base: (process.env.ODOO_DB ?? '').trim() };
  rapport.version = await essayer(() => odooVersion());

  // ── Quel protocole répond avec ces clés ? JSON-2 d'abord ; l'historique
  //    n'est essayé que si JSON-2 échoue. ──
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
  const champs = async (model: string, candidats: string[]): Promise<ChampsInfo> =>
    (await lire<ChampsInfo>(model, 'fields_get', {
      allfields: candidats,
      attributes: ['type', 'selection'],
    })) ?? {};
  const presents = (info: ChampsInfo, liste: string[]) => liste.filter((c) => c in info);
  const absents = (info: ChampsInfo, liste: string[]) => liste.filter((c) => !(c in info));
  // Toutes les lignes d'un domaine, par pages, l'une après l'autre.
  const lireTout = async (
    model: string,
    domain: Domaine,
    fields: string[],
    order: string,
  ): Promise<{ lignes: Ligne[]; tronque: boolean }> => {
    const lignes: Ligne[] = [];
    for (let page = 0; page < PAGES_MAX; page += 1) {
      const lot = await lire<Ligne[]>(model, 'search_read', {
        domain,
        fields,
        limit: PAGE,
        offset: page * PAGE,
        order,
      });
      lignes.push(...lot);
      if (lot.length < PAGE) return { lignes, tronque: false };
    }
    return { lignes, tronque: true };
  };

  // ── Sociétés visibles par l'utilisateur de la clé ──
  const societes = await essayer(() =>
    lire<Ligne[]>('res.company', 'search_read', { domain: [], fields: ['name'], limit: 20 }),
  );
  rapport.societes = societes;
  const nomSociete = new Map<number, string>();
  if (Array.isArray(societes)) {
    for (const s of societes) {
      const id = idDe(s.id);
      if (id != null) nomSociete.set(id, texte(s.name) ?? `société ${id}`);
    }
  }
  const parSocieteVide = () =>
    new Map<number, Record<string, unknown>>(
      [...nomSociete].map(([id, name]) => [id, { id, name }] as const),
    );
  const compterSociete = (
    table: Map<number, Record<string, unknown>>,
    societe: unknown,
    cle: string,
  ): void => {
    const id = idDe(societe);
    if (id == null) return;
    const ligne = table.get(id) ?? { id, name: nomSociete.get(id) ?? null };
    ligne[cle] = (typeof ligne[cle] === 'number' ? (ligne[cle] as number) : 0) + 1;
    table.set(id, ligne);
  };

  // ── Factures (account.move) ──
  rapport.factures = await essayer(async () => {
    const info = await champs('account.move', CHAMPS_MOVE);
    const { lignes, tronque } = await lireTout(
      'account.move',
      ['&', ['move_type', 'in', TYPES_FACTURE], '|', ['date', '>=', DEPUIS], ['invoice_date', '>=', DEPUIS]],
      presents(info, COMPTAGE_MOVE),
      'id asc',
    );

    const bloc = () => ({
      total: 0,
      par_etat_paiement: {} as Record<string, number>,
      premiere_date: null as string | null,
      derniere_date: null as string | null,
    });
    const blocs: Record<string, ReturnType<typeof bloc>> = {
      out_invoice: bloc(),
      out_refund: bloc(),
      in_invoice: bloc(),
      in_refund: bloc(),
    };
    let brouillons = 0;
    let annulees = 0;
    const parSociete = parSocieteVide();

    for (const r of lignes) {
      const type = texte(r.move_type);
      if (!type || !(type in blocs)) continue;
      const etat = texte(r.state);
      if (etat === 'draft') { brouillons += 1; continue; }
      if (etat === 'cancel') { annulees += 1; continue; }
      if (etat !== 'posted') continue;
      const jour = texte(r.invoice_date) ?? texte(r.date);
      if (!jour || jour < DEPUIS) continue;

      const b = blocs[type];
      b.total += 1;
      incrementer(b.par_etat_paiement, texte(r.payment_state));
      if (!b.premiere_date || jour < b.premiere_date) b.premiere_date = jour;
      if (!b.derniere_date || jour > b.derniere_date) b.derniere_date = jour;
      if (type === 'out_invoice') compterSociete(parSociete, r.company_id, 'ventes');
      if (type === 'in_invoice') compterSociete(parSociete, r.company_id, 'achats');
    }

    // Échantillon : de préférence des pièces déjà réglées, pour voir comment
    // Odoo y rattache les paiements ; à défaut, les plus récentes.
    const champsEchantillon = presents(info, ECHANTILLON_MOVE);
    const echantillon = async (type: string) => {
      const base: Domaine = [
        ['move_type', '=', type],
        ['state', '=', 'posted'],
        ['invoice_date', '>=', DEPUIS],
      ];
      const lireEchantillon = (domain: Domaine) =>
        lire<Ligne[]>('account.move', 'search_read', {
          domain,
          fields: champsEchantillon,
          limit: 3,
          order: 'invoice_date desc, id desc',
        });
      let rows =
        'payment_state' in info
          ? await lireEchantillon([...base, ['payment_state', 'in', ETATS_REGLES]])
          : [];
      if (rows.length === 0) rows = await lireEchantillon(base);
      return rows.map(nettoyerMove);
    };

    return {
      champs_absents: absents(info, CHAMPS_MOVE),
      etats_paiement_possibles: (info.payment_state?.selection ?? []).map(([v]) => v),
      lignes_lues: lignes.length,
      tronque,
      ventes: blocs.out_invoice,
      notes_credit_ventes: blocs.out_refund,
      achats: blocs.in_invoice,
      notes_credit_achats: blocs.in_refund,
      brouillons,
      annulees,
      par_societe: [...parSociete.values()],
      echantillon_ventes: await echantillon('out_invoice'),
      echantillon_achats: await echantillon('in_invoice'),
    };
  });

  // ── Paiements enregistrés (account.payment) ──
  rapport.paiements = await essayer(async () => {
    const info = await champs('account.payment', CHAMPS_PAIEMENT);
    const base: Domaine = [['date', '>=', DEPUIS]];
    const { lignes, tronque } = await lireTout(
      'account.payment',
      base,
      presents(info, COMPTAGE_PAIEMENT),
      'id asc',
    );

    let recus = 0;
    let envoyes = 0;
    const parEtat: Record<string, number> = {};
    const parSociete = parSocieteVide();
    for (const r of lignes) {
      const sens = texte(r.payment_type);
      if (sens === 'inbound') { recus += 1; compterSociete(parSociete, r.company_id, 'recus'); }
      if (sens === 'outbound') { envoyes += 1; compterSociete(parSociete, r.company_id, 'envoyes'); }
      incrementer(parEtat, texte(r.state));
    }

    return {
      champs_absents: absents(info, CHAMPS_PAIEMENT),
      etats_possibles: (info.state?.selection ?? []).map(([v]) => v),
      total: lignes.length,
      tronque,
      recus,
      envoyes,
      par_etat: parEtat,
      par_societe: [...parSociete.values()],
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
    const { lignes, tronque } = await lireTout(
      'account.bank.statement.line',
      [['date', '>=', DEPUIS]],
      presents(info, COMPTAGE_LIGNE_BANQUE),
      'date desc, id desc',
    );

    let entrees = 0;
    let sorties = 0;
    let rapprochees = 0;
    let nonRapprochees = 0;
    const parSociete = parSocieteVide();
    for (const r of lignes) {
      const montant = typeof r.amount === 'number' ? r.amount : 0;
      if (montant > 0) { entrees += 1; compterSociete(parSociete, r.company_id, 'entrees'); }
      if (montant < 0) { sorties += 1; compterSociete(parSociete, r.company_id, 'sorties'); }
      if (r.is_reconciled === true) rapprochees += 1;
      if (r.is_reconciled === false) nonRapprochees += 1;
    }

    return {
      champs_absents: absents(info, CHAMPS_LIGNE_BANQUE),
      total: lignes.length,
      tronque,
      entrees,
      sorties,
      ...('is_reconciled' in info ? { rapprochees, non_rapprochees: nonRapprochees } : {}),
      par_societe: [...parSociete.values()],
      // Les 3 plus récentes (les lignes arrivent déjà triées).
      echantillon: lignes.slice(0, 3).map((r) => ({
        id: r.id ?? null,
        date: r.date ?? null,
        amount: r.amount ?? null,
        is_reconciled: r.is_reconciled ?? null,
      })),
    };
  });

  rapport.ok = true;
  return clore();
}
