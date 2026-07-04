// Connecteur Odoo — DÉBRANCHÉ PAR DÉFAUT (chantier Facturation v2, bloc C).
//
// Client JSON-RPC minimal (fetch natif, aucune dépendance). Double
// interrupteur, même patron que Storecove :
//   1. Configuration serveur : env ODOO_URL, ODOO_DB, ODOO_USER, ODOO_API_KEY.
//   2. Interrupteur métier : parametres.odoo_sync_enabled === 'true'.
// Tant que les deux ne sont pas réunis, AUCUN appel réseau.
//
// ── Hypothèses (Odoo 17 — à VÉRIFIER au branchement réel) :
//   - Endpoint JSON-RPC standard : POST <ODOO_URL>/jsonrpc, service
//     'common'.authenticate puis 'object'.execute_kw.
//   - analytic_distribution est le format Odoo 17 ({ "<id>": 100 }) —
//     remplace analytic_account_id des versions ≤ 16.
//   - La création d'un account.analytic.account sans plan_id explicite
//     suppose qu'un plan analytique par défaut existe dans la base Odoo.
//   - Les taxes sont résolues par account.tax (amount = taux, type_tax_use
//     sale/purchase) — si aucune ne matche, la ligne part SANS taxe et
//     l'écart sera visible dans Odoo (best-effort assumé).
//
// Best-effort : les fonctions push* ne throw jamais — { ok, error? } et
// écriture de odoo_move_id / odoo_pushed_at en cas de succès.

import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeTva } from '@/lib/agents/extraction-achat';
import type { Facture, FactureAchat, FactureLigne } from '@/lib/types/database';

export type OdooPushResult =
  | { ok: true; moveId: number }
  | { ok: false; error: string };

export function isOdooConfigured(): boolean {
  return Boolean(
    process.env.ODOO_URL?.trim()
    && process.env.ODOO_DB?.trim()
    && process.env.ODOO_USER?.trim()
    && process.env.ODOO_API_KEY?.trim(),
  );
}

export async function isOdooEnabled(): Promise<boolean> {
  if (!isOdooConfigured()) return false;
  const admin = createAdminClient();
  const { data } = await admin
    .from('parametres')
    .select('valeur')
    .eq('cle', 'odoo_sync_enabled')
    .maybeSingle();
  return data?.valeur === 'true';
}

// ─── Client JSON-RPC minimal ────────────────────────────────────────────────

async function jsonRpc(service: string, method: string, args: unknown[]): Promise<unknown> {
  const url = `${process.env.ODOO_URL!.replace(/\/+$/, '')}/jsonrpc`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      params: { service, method, args },
      id: Math.floor(Math.random() * 1_000_000),
    }),
  });
  if (!res.ok) throw new Error(`Odoo HTTP ${res.status}`);
  const json = (await res.json()) as {
    result?: unknown;
    error?: { message?: string; data?: { message?: string } };
  };
  if (json.error) {
    throw new Error(json.error.data?.message ?? json.error.message ?? 'Erreur Odoo.');
  }
  return json.result;
}

let cachedUid: number | null = null;

async function authenticate(): Promise<number> {
  if (cachedUid) return cachedUid;
  const uid = await jsonRpc('common', 'authenticate', [
    process.env.ODOO_DB,
    process.env.ODOO_USER,
    process.env.ODOO_API_KEY,
    {},
  ]);
  if (typeof uid !== 'number' || uid <= 0) {
    throw new Error('Authentification Odoo refusée (vérifier ODOO_USER / ODOO_API_KEY).');
  }
  cachedUid = uid;
  return uid;
}

async function executeKw(
  model: string,
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown> = {},
): Promise<unknown> {
  const uid = await authenticate();
  return jsonRpc('object', 'execute_kw', [
    process.env.ODOO_DB,
    uid,
    process.env.ODOO_API_KEY,
    model,
    method,
    args,
    kwargs,
  ]);
}

// ─── Helpers métier ─────────────────────────────────────────────────────────

async function findOrCreatePartner(args: {
  name: string;
  vat?: string | null;
  isSupplier?: boolean;
}): Promise<number> {
  const vat = normalizeTva(args.vat);
  // Par TVA d'abord (identifiant fort), sinon par nom exact insensible.
  if (vat) {
    const byVat = (await executeKw('res.partner', 'search', [[['vat', '=', vat]]], { limit: 1 })) as number[];
    if (byVat.length > 0) return byVat[0];
  }
  const byName = (await executeKw('res.partner', 'search', [[['name', '=ilike', args.name]]], { limit: 1 })) as number[];
  if (byName.length > 0) return byName[0];

  const created = await executeKw('res.partner', 'create', [{
    name: args.name,
    ...(vat ? { vat } : {}),
    ...(args.isSupplier ? { supplier_rank: 1 } : { customer_rank: 1 }),
  }]);
  if (typeof created !== 'number') throw new Error('Création res.partner échouée.');
  return created;
}

// Compte analytique par dossier : name = ref de l'intervention (créé s'il
// manque — hypothèse : plan analytique par défaut présent, cf. en-tête).
async function findOrCreateAnalytic(ref: string): Promise<number | null> {
  try {
    const found = (await executeKw('account.analytic.account', 'search', [[['name', '=', ref]]], { limit: 1 })) as number[];
    if (found.length > 0) return found[0];
    const created = await executeKw('account.analytic.account', 'create', [{ name: ref }]);
    return typeof created === 'number' ? created : null;
  } catch {
    // L'analytique ne doit pas bloquer le push — la pièce part sans.
    return null;
  }
}

async function findTaxId(amount: number, typeTaxUse: 'sale' | 'purchase'): Promise<number | null> {
  try {
    const found = (await executeKw('account.tax', 'search', [[
      ['amount', '=', amount],
      ['type_tax_use', '=', typeTaxUse],
    ]], { limit: 1 })) as number[];
    return found.length > 0 ? found[0] : null;
  } catch {
    return null;
  }
}

async function analyticForIntervention(interventionId: string | null): Promise<number | null> {
  if (!interventionId) return null;
  const admin = createAdminClient();
  const { data: iv } = await admin
    .from('interventions')
    .select('ref')
    .eq('id', interventionId)
    .maybeSingle();
  const ref = (iv?.ref as string | null)?.trim();
  if (!ref) return null;
  return findOrCreateAnalytic(ref);
}

// ─── Push facture de VENTE (ou avoir) ───────────────────────────────────────

export async function pushFactureVente(factureId: string): Promise<OdooPushResult> {
  if (!(await isOdooEnabled())) {
    return { ok: false, error: 'Odoo non activé — configurez la synchronisation dans Paramètres.' };
  }
  const admin = createAdminClient();
  const { data: row } = await admin.from('factures').select('*').eq('id', factureId).maybeSingle();
  if (!row) return { ok: false, error: 'Document introuvable.' };
  const facture = row as Facture;

  if (facture.type === 'devis') return { ok: false, error: 'Un devis ne se pousse pas vers Odoo.' };
  if (facture.statut === 'brouillon' || facture.numero.startsWith('BR-')) {
    return { ok: false, error: 'Émets d\'abord le document (numéro définitif requis).' };
  }
  if (facture.odoo_move_id) {
    return { ok: false, error: `Déjà poussé vers Odoo (move ${facture.odoo_move_id}).` };
  }

  try {
    const isAvoir = facture.type === 'avoir';
    // Avoir FoxO = montants négatifs ; out_refund Odoo = montants positifs.
    const sign = isAvoir ? -1 : 1;

    const partnerId = await findOrCreatePartner({
      name: (facture.client_nom ?? 'Client').trim() || 'Client',
      vat: facture.client_bce,
    });
    const analyticId = await analyticForIntervention(facture.intervention_id);
    const taxId = await findTaxId(Number(facture.tva_pct ?? 0), 'sale');

    const lignes: FactureLigne[] = Array.isArray(facture.lignes) ? facture.lignes : [];
    const lineVals = lignes.map((l) => {
      let quantity = sign * Number(l.quantite ?? 0);
      let priceUnit = Number(l.prix_unitaire ?? 0);
      if (priceUnit < 0) { priceUnit = -priceUnit; quantity = -quantity; }
      return [0, 0, {
        name: l.description || 'Prestation',
        quantity,
        price_unit: priceUnit,
        ...(taxId ? { tax_ids: [[6, 0, [taxId]]] } : {}),
        ...(analyticId ? { analytic_distribution: { [String(analyticId)]: 100 } } : {}),
      }];
    });

    const moveId = await executeKw('account.move', 'create', [{
      move_type: isAvoir ? 'out_refund' : 'out_invoice',
      partner_id: partnerId,
      invoice_date: facture.date_emission ?? undefined,
      invoice_date_due: facture.date_echeance ?? undefined,
      ref: facture.numero,
      payment_reference: facture.reference_structuree ?? facture.numero,
      invoice_line_ids: lineVals,
    }]);
    if (typeof moveId !== 'number') throw new Error('Création account.move échouée.');

    await admin
      .from('factures')
      .update({
        odoo_move_id: String(moveId),
        odoo_pushed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', factureId);

    return { ok: true, moveId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur Odoo.' };
  }
}

// ─── Push facture d'ACHAT ───────────────────────────────────────────────────

export async function pushFactureAchat(id: string): Promise<OdooPushResult> {
  if (!(await isOdooEnabled())) {
    return { ok: false, error: 'Odoo non activé — configurez la synchronisation dans Paramètres.' };
  }
  const admin = createAdminClient();
  const { data: row } = await admin
    .from('factures_achat')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!row) return { ok: false, error: 'Facture d\'achat introuvable.' };
  const fa = row as FactureAchat;

  if (fa.statut === 'a_valider' || fa.statut === 'rejetee') {
    return { ok: false, error: 'Valide d\'abord la facture (statut à payer ou payée).' };
  }
  if (fa.odoo_move_id) {
    return { ok: false, error: `Déjà poussé vers Odoo (move ${fa.odoo_move_id}).` };
  }
  const nomFournisseur = (fa.fournisseur_nom ?? '').trim();
  if (!nomFournisseur) return { ok: false, error: 'Nom fournisseur manquant.' };

  try {
    // TVA de la fiche fournisseur si liée, sinon celle extraite (ia_raw).
    let vat: string | null = null;
    if (fa.fournisseur_id) {
      const { data: f } = await admin.from('fournisseurs').select('tva').eq('id', fa.fournisseur_id).maybeSingle();
      vat = (f?.tva as string | null) ?? null;
    }
    if (!vat && fa.ia_raw && typeof fa.ia_raw.fournisseur_tva === 'string') {
      vat = fa.ia_raw.fournisseur_tva;
    }

    const partnerId = await findOrCreatePartner({ name: nomFournisseur, vat, isSupplier: true });
    const analyticId = await analyticForIntervention(fa.intervention_id);
    const taxId = fa.taux_tva != null ? await findTaxId(Number(fa.taux_tva), 'purchase') : null;

    // Lignes extraites si présentes, sinon une ligne unique au montant HT
    // (fallback TTC si le HT manque — écart de taxe visible dans Odoo).
    const lignesSrc = Array.isArray(fa.lignes) && fa.lignes.length > 0
      ? fa.lignes.map((l) => ({
          name: l.description || 'Achat',
          quantity: Number(l.quantite ?? 1) || 1,
          price_unit: Number(l.prix_unitaire ?? l.montant ?? 0),
        }))
      : [{
          name: `Facture ${fa.numero_piece ?? 'fournisseur'}`,
          quantity: 1,
          price_unit: Number(fa.montant_ht ?? fa.montant_ttc ?? 0),
        }];
    const lineVals = lignesSrc.map((l) => [0, 0, {
      ...l,
      ...(taxId ? { tax_ids: [[6, 0, [taxId]]] } : {}),
      ...(analyticId ? { analytic_distribution: { [String(analyticId)]: 100 } } : {}),
    }]);

    const moveId = await executeKw('account.move', 'create', [{
      move_type: 'in_invoice',
      partner_id: partnerId,
      invoice_date: fa.date_facture ?? undefined,
      invoice_date_due: fa.date_echeance ?? undefined,
      ref: fa.numero_piece ?? undefined,
      invoice_line_ids: lineVals,
    }]);
    if (typeof moveId !== 'number') throw new Error('Création account.move échouée.');

    await admin
      .from('factures_achat')
      .update({
        odoo_move_id: String(moveId),
        odoo_pushed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    return { ok: true, moveId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur Odoo.' };
  }
}
