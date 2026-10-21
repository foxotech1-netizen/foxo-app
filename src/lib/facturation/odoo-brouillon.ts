// Brouillon de facture de vente dans Odoo, créé depuis un dossier FoxO.
//
// Décision Foxo (20-21/10/2026) : FoxO crée un BROUILLON dans Odoo, jamais
// validé par FoxO. Foxo contrôle, valide et envoie depuis Odoo ; la synchro
// de lecture (odoo-sync.ts) ramène ensuite la facture validée, reliée au
// dossier par la référence « 2026-xxx adresse » que ce module pose dans le
// champ « ref » d'Odoo.
//
// Deux temps :
//   preparerBrouillon  : lecture seule — retrouve le client Odoo (miroir,
//                        BCE dans le nom ou le champ TVA, e-mail), lit le
//                        catalogue (produits, taxes), propose lignes et note.
//   creerBrouillonOdoo : écrit — crée la fiche client si demandé, puis la
//                        facture brouillon ; enregistre odoo_brouillons.
// Rien n'est codé en dur côté métier : produits, prix, taux, comptes et
// condition de paiement viennent d'Odoo ; le numéro de facture est laissé à
// Odoo. Une exception voulue : la COMMUNICATION STRUCTURÉE est dérivée par
// FoxO du numéro de dossier (2026-238 → +++000/2026/238xx+++) et posée sur le
// brouillon, pour qu'un client puisse payer sur place (QR) avant la
// validation ; Odoo la conserve à la validation si elle est déjà remplie.

import { TYPE_OCCUPANT_LABEL, type TypeOccupant } from '@/lib/types/database';
import { TZ_BRUSSELS } from '@/lib/format';
import { VENDOR } from '@/lib/constants/vendor';
import { loadInterventionForFacture } from '@/app/admin/facturation/actions';
import { generateBBA } from './bba';
import { generateEpcQrDataUrl } from './epc-qr';
import { odooHost } from './odoo-transport';
import {
  creerJournalise,
  lireJournalise,
  odooEcritureActive,
  ouvrirContexte,
  rattacherJournal,
  type ContexteOdoo,
} from './odoo-write';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ClientOdoo {
  id: number;
  nom: string;
  email: string | null;
}

export interface NouveauClient {
  nom: string;
  email: string | null;
  bce: string | null;
  adresse_ligne1: string | null;
  adresse_ligne2: string | null;
  code_postal: string | null;
  ville: string | null;
}

export interface ProduitOdoo {
  id: number;
  nom: string;
  prix: number;
  taux_tva: number;
}

export interface LigneBrouillon {
  produit_id: number | null;
  libelle: string;
  quantite: number;
  prix_unitaire: number;
  taux_tva: number;
}

export interface SaisieBrouillon {
  /** Client Odoo existant choisi — ou null pour créer `nouveau_client`. */
  partner_id: number | null;
  nouveau_client: NouveauClient | null;
  /** Champ « Référence » d'Odoo : « 2026-238 Rue Willems 14 ». */
  reference: string;
  /** AAAA-MM-JJ. */
  date_facture: string;
  lignes: LigneBrouillon[];
  /** Ligne « note » sous les lignes (réf. courtier, adresse, occupants). */
  note: string | null;
}

export interface PreparationBrouillon {
  dossier: { id: string; ref: string; adresse: string | null };
  client: {
    propose: ClientOdoo | null;
    source: 'miroir' | 'bce' | 'email' | null;
    candidats: ClientOdoo[];
    nouveau: NouveauClient;
  };
  saisie: SaisieBrouillon;
  /** `frequents` : identifiants des produits les plus utilisés, du plus au moins fréquent. */
  catalogue: { produits: ProduitOdoo[]; taux: number[]; frequents: number[] };
  /** Condition de paiement la plus utilisée sur les dernières factures (nom Odoo), ou null. */
  condition_paiement: string | null;
  /** Communication structurée que portera le brouillon. */
  communication: string;
  /** Raison pour laquelle on ne crée PAS de brouillon (déjà un, déjà facturé). */
  blocage: string | null;
  ecriture_active: boolean;
  odoo_url: string | null;
}

/** De quoi faire payer sur place : QR EPC (image) + données lisibles. */
export interface PaiementBrouillon {
  iban: string;
  beneficiaire: string;
  montant_ttc: number;
  communication: string;
  qr_data_url: string;
}

export type ResultatCreation =
  | { ok: true; brouillon_id: string; odoo_move_id: number; odoo_url: string | null; partner_cree: boolean; paiement: PaiementBrouillon }
  | { ok: false; erreur: string };

type Ligne = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CACHE_TTL_MS = 10 * 60_000;

// ─── Petits utilitaires ─────────────────────────────────────────────────────

function idDe(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (Array.isArray(v) && typeof v[0] === 'number') return v[0];
  if (v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'number') {
    return (v as { id: number }).id;
  }
  return null;
}

function texte(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function nombre(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function arrondi(n: number): number {
  return Math.round(n * 100) / 100;
}

export function aujourdhuiBruxelles(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ_BRUSSELS });
}

/** « 0850.924.580 » / « BE 0850 924 580 » → « 0850924580 » (10 chiffres) ou null. */
export function bceChiffres(v: string | null | undefined): string | null {
  const d = (v ?? '').replace(/\D/g, '');
  return d.length === 10 ? d : null;
}

/** « 0850924580 » → « 0850.924.580 » (écriture habituelle de Foxo dans Odoo). */
export function bcePointe(chiffres: string): string {
  return `${chiffres.slice(0, 4)}.${chiffres.slice(4, 7)}.${chiffres.slice(7)}`;
}

/** « Rue Willems 14, 1210 Saint-Josse » → « Rue Willems 14 ». */
function rueEtNumero(adresse: string | null): string {
  return (adresse ?? '').split(',')[0].trim();
}

/** « Avenue De Fré 229, 1180 Uccle » → { ligne, code_postal, ville }. */
function decouperAdresse(adresse: string | null): { ligne: string | null; code_postal: string | null; ville: string | null } {
  const a = (adresse ?? '').trim();
  if (!a) return { ligne: null, code_postal: null, ville: null };
  const m = a.match(/^(.*?),?\s*(\d{4})\s+(.+)$/);
  if (!m) return { ligne: a, code_postal: null, ville: null };
  return { ligne: m[1].trim() || null, code_postal: m[2], ville: m[3].trim() };
}

// ─── Catalogue Odoo (produits, taxes), mémorisé dix minutes ─────────────────

interface TaxeOdoo { id: number; nom: string; taux: number }
interface TermeOdoo { id: number; nom: string }
interface Catalogue { taxes: TaxeOdoo[]; produits: ProduitOdoo[]; produitParDefaut: number | null; frequents: number[]; terme: TermeOdoo | null; expire: number }

const catalogueCache = new Map<number, Catalogue>();

async function lireCatalogue(ctx: ContexteOdoo): Promise<Catalogue> {
  const enCache = catalogueCache.get(ctx.societeOdoo);
  if (enCache && enCache.expire > Date.now()) return enCache;

  const taxesBrutes = await lireJournalise<Ligne[]>(ctx, 'account.tax', 'search_read', {
    domain: [
      ['type_tax_use', '=', 'sale'],
      ['company_id', '=', ctx.societeOdoo],
      ['amount_type', '=', 'percent'],
      ['active', '=', true],
    ],
    fields: ['name', 'amount'],
    limit: 50,
  }, { quoi: 'taxes de vente' });
  const taxes: TaxeOdoo[] = taxesBrutes
    .map((t) => ({ id: idDe(t.id) ?? 0, nom: texte(t.name) ?? '', taux: nombre(t.amount) }))
    .filter((t) => t.id > 0);
  const tauxDe = (ids: unknown): number | null => {
    if (!Array.isArray(ids)) return null;
    for (const id of ids) {
      const t = taxes.find((x) => x.id === idDe(id));
      if (t) return t.taux;
    }
    return null;
  };

  const produitsBruts = await lireJournalise<Ligne[]>(ctx, 'product.product', 'search_read', {
    domain: [
      ['sale_ok', '=', true],
      ['active', '=', true],
      '|', ['company_id', '=', false], ['company_id', '=', ctx.societeOdoo],
    ],
    fields: ['name', 'list_price', 'taxes_id'],
    order: 'name',
    limit: 200,
  }, { quoi: 'produits vendables' });
  const produits: ProduitOdoo[] = produitsBruts
    .map((p) => ({
      id: idDe(p.id) ?? 0,
      nom: texte(p.name) ?? '',
      prix: arrondi(nombre(p.list_price)),
      taux_tva: tauxDe(p.taxes_id) ?? 21,
    }))
    .filter((p) => p.id > 0 && p.nom);

  // Produits les plus utilisés sur les dernières factures de vente ; le
  // premier sert de produit par défaut.
  let produitParDefaut: number | null = null;
  let frequents: number[] = [];
  try {
    const lignes = await lireJournalise<Ligne[]>(ctx, 'account.move.line', 'search_read', {
      domain: [
        ['move_id.move_type', '=', 'out_invoice'],
        ['display_type', '=', 'product'],
        ['product_id', '!=', false],
        ['company_id', '=', ctx.societeOdoo],
      ],
      fields: ['product_id'],
      order: 'id desc',
      limit: 100,
    }, { quoi: 'produit le plus utilisé (100 dernières lignes)' });
    const compte = new Map<number, number>();
    for (const l of lignes) {
      const id = idDe(l.product_id);
      if (id != null && produits.some((p) => p.id === id)) compte.set(id, (compte.get(id) ?? 0) + 1);
    }
    frequents = [...compte.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    produitParDefaut = frequents[0] ?? null;
  } catch {
    produitParDefaut = null;
    frequents = [];
  }

  // Condition de paiement = la plus utilisée sur les dernières factures de
  // vente validées (les fiches clients n'en portent pas toujours).
  let terme: TermeOdoo | null = null;
  try {
    const factures = await lireJournalise<Ligne[]>(ctx, 'account.move', 'search_read', {
      domain: [
        ['move_type', '=', 'out_invoice'],
        ['state', '=', 'posted'],
        ['company_id', '=', ctx.societeOdoo],
        ['invoice_payment_term_id', '!=', false],
      ],
      fields: ['invoice_payment_term_id'],
      order: 'id desc',
      limit: 100,
    }, { quoi: 'condition de paiement la plus utilisée (100 dernières factures)' });
    const compte = new Map<number, { n: number; nom: string }>();
    for (const f of factures) {
      const id = idDe(f.invoice_payment_term_id);
      if (id == null) continue;
      const nom = Array.isArray(f.invoice_payment_term_id) && typeof f.invoice_payment_term_id[1] === 'string'
        ? f.invoice_payment_term_id[1]
        : (f.invoice_payment_term_id as { display_name?: string } | null)?.display_name ?? `condition ${id}`;
      const c = compte.get(id) ?? { n: 0, nom };
      c.n += 1;
      compte.set(id, c);
    }
    for (const [id, c] of compte) {
      if (terme === null || c.n > (compte.get(terme.id)?.n ?? 0)) terme = { id, nom: c.nom };
    }
  } catch {
    terme = null;
  }

  const catalogue: Catalogue = { taxes, produits, produitParDefaut, frequents, terme, expire: Date.now() + CACHE_TTL_MS };
  catalogueCache.set(ctx.societeOdoo, catalogue);
  return catalogue;
}

/** Taxe Odoo pour un taux : le nom exact « 21% » d'abord, sinon la première au même taux. */
function taxePourTaux(catalogue: Catalogue, taux: number): TaxeOdoo | null {
  const memeTaux = catalogue.taxes.filter((t) => t.taux === taux);
  return memeTaux.find((t) => t.nom === `${taux}%`) ?? memeTaux[0] ?? null;
}

// ─── Pays (Belgique), mémorisé ──────────────────────────────────────────────

let belgiqueCache: { id: number; expire: number } | null = null;

async function idBelgique(ctx: ContexteOdoo): Promise<number | null> {
  if (belgiqueCache && belgiqueCache.expire > Date.now()) return belgiqueCache.id;
  const rows = await lireJournalise<Ligne[]>(ctx, 'res.country', 'search_read', {
    domain: [['code', '=', 'BE']],
    fields: ['name'],
    limit: 1,
  }, { quoi: 'pays BE' });
  const id = idDe(rows[0]?.id);
  if (id == null) return null;
  belgiqueCache = { id, expire: Date.now() + CACHE_TTL_MS };
  return id;
}

// ─── Dossier FoxO ───────────────────────────────────────────────────────────

interface DossierCharge {
  id: string;
  ref: string;
  acp_id: string | null;
  client_id: string | null;
  reference_externe: string | null;
  reference_sinistre: string | null;
  assureur_nom: string | null;
  client_nom: string | null;
  client_email: string | null;
  client_adresse: string | null;
  client_bce: string | null;
  client_syndic: string | null;
  adresse_intervention: string | null;
  acp_nom: string | null;
  occupants: Array<{ appartement: string | null; prenom: string | null; nom: string | null; type_occupant: TypeOccupant | null }>;
}

async function chargerDossier(ctx: ContexteOdoo, interventionId: string): Promise<DossierCharge> {
  if (!UUID.test(interventionId)) throw new Error('Dossier inconnu.');
  const { data: iv, error } = await ctx.admin
    .from('interventions')
    .select('id, ref, acp_id, client_id, reference_externe, assureur, acp:acps(nom)')
    .eq('id', interventionId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error || !iv) throw new Error('Dossier introuvable.');
  const row = iv as unknown as {
    id: string; ref: string | null; acp_id: string | null; client_id: string | null;
    reference_externe: string | null; assureur: { nom?: string | null; reference_sinistre?: string | null } | null;
    acp: { nom: string | null } | { nom: string | null }[] | null;
  };
  const ref = texte(row.ref);
  if (!ref) throw new Error('Ce dossier n\'a pas encore de numéro.');

  // Débiteur et adresse : la même règle que les factures FoxO (ACP débiteur,
  // syndic c/o ; particulier ; courtier).
  const partie = await loadInterventionForFacture(interventionId);
  if (!partie.ok || !partie.data) throw new Error(!partie.ok ? partie.error : 'Dossier illisible.');

  const { data: occ } = await ctx.admin
    .from('occupants')
    .select('appartement, prenom, nom, type_occupant')
    .eq('intervention_id', interventionId)
    .order('appartement', { ascending: true, nullsFirst: false });

  const acp = Array.isArray(row.acp) ? row.acp[0] ?? null : row.acp;
  return {
    id: row.id,
    ref,
    acp_id: row.acp_id,
    client_id: row.client_id,
    reference_externe: texte(row.reference_externe),
    reference_sinistre: texte(row.assureur?.reference_sinistre),
    assureur_nom: texte(row.assureur?.nom),
    client_nom: partie.data.client_nom,
    client_email: partie.data.client_email,
    client_adresse: partie.data.client_adresse,
    client_bce: partie.data.client_bce,
    client_syndic: partie.data.client_syndic,
    adresse_intervention: partie.data.details.adresse_intervention ?? null,
    acp_nom: acp?.nom ?? null,
    occupants: ((occ ?? []) as DossierCharge['occupants']),
  };
}

/** Ce qui empêche de créer un brouillon pour ce dossier (null = rien). */
async function blocagePour(ctx: ContexteOdoo, dossier: DossierCharge): Promise<string | null> {
  const { data: existant } = await ctx.admin
    .from('odoo_brouillons')
    .select('odoo_move_id, etat, cree_le')
    .eq('intervention_id', dossier.id)
    .eq('etat', 'brouillon')
    .order('cree_le', { ascending: false })
    .limit(1)
    .maybeSingle();
  const b = existant as { odoo_move_id: number; cree_le: string } | null;
  if (b) {
    return `Un brouillon existe déjà dans Odoo pour ce dossier (créé le ${new Date(b.cree_le).toLocaleDateString('fr-BE', { timeZone: TZ_BRUSSELS })}). Ouvre-le dans Odoo pour le valider ou le supprimer.`;
  }
  const { data: facture } = await ctx.admin
    .from('odoo_factures')
    .select('numero')
    .eq('intervention_id', dossier.id)
    .eq('sens', 'vente')
    .eq('est_note_credit', false)
    .limit(1)
    .maybeSingle();
  const f = facture as { numero: string | null } | null;
  if (f) return `Ce dossier a déjà une facture validée dans Odoo (${f.numero ?? 'sans numéro'}).`;
  return null;
}

// ─── Client Odoo ────────────────────────────────────────────────────────────

function clientDe(r: Ligne): ClientOdoo | null {
  const id = idDe(r.id);
  const nom = texte(r.name) ?? texte(r.display_name);
  if (id == null || !nom) return null;
  return { id, nom, email: texte(r.email) };
}

/** Client déjà facturé pour le même immeuble / le même client FoxO (0 appel Odoo). */
async function clientParMiroir(ctx: ContexteOdoo, dossier: DossierCharge): Promise<ClientOdoo | null> {
  const cle = dossier.acp_id ? { colonne: 'acp_id', valeur: dossier.acp_id }
    : dossier.client_id ? { colonne: 'client_id', valeur: dossier.client_id } : null;
  if (!cle) return null;
  const { data: ivs } = await ctx.admin
    .from('interventions')
    .select('id')
    .eq(cle.colonne, cle.valeur)
    .limit(200);
  const ids = ((ivs ?? []) as { id: string }[]).map((x) => x.id);
  if (ids.length === 0) return null;
  const { data: f } = await ctx.admin
    .from('odoo_factures')
    .select('odoo_tiers_id, tiers_nom')
    .in('intervention_id', ids)
    .eq('sens', 'vente')
    .not('odoo_tiers_id', 'is', null)
    .order('date_facture', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  const row = f as { odoo_tiers_id: number; tiers_nom: string | null } | null;
  if (!row) return null;
  return { id: row.odoo_tiers_id, nom: row.tiers_nom ?? `Client Odoo ${row.odoo_tiers_id}`, email: null };
}

async function clientsParBce(ctx: ContexteOdoo, bce: string | null): Promise<ClientOdoo[]> {
  const chiffres = bceChiffres(bce);
  if (!chiffres) return [];
  const rows = await lireJournalise<Ligne[]>(ctx, 'res.partner', 'search_read', {
    domain: [
      '|', '|',
      ['vat', 'ilike', chiffres],
      ['name', 'ilike', bcePointe(chiffres)],
      ['name', 'ilike', chiffres],
    ],
    fields: ['name', 'email', 'customer_rank'],
    order: 'customer_rank desc',
    limit: 5,
  }, { quoi: 'client par BCE', bce: bcePointe(chiffres) });
  return rows.map(clientDe).filter((c): c is ClientOdoo => c !== null);
}

async function clientsParEmail(ctx: ContexteOdoo, email: string | null): Promise<ClientOdoo[]> {
  const e = texte(email);
  if (!e) return [];
  const rows = await lireJournalise<Ligne[]>(ctx, 'res.partner', 'search_read', {
    domain: [['email', '=ilike', e]],
    fields: ['name', 'email', 'customer_rank'],
    order: 'customer_rank desc',
    limit: 5,
  }, { quoi: 'client par e-mail' });
  return rows.map(clientDe).filter((c): c is ClientOdoo => c !== null);
}

/** Recherche libre pour le sélecteur de l'écran (nom ou e-mail). */
export async function chercherClientsOdoo(texteRecherche: string, appelePar: string | null): Promise<ClientOdoo[]> {
  const t = texteRecherche.trim();
  if (t.length < 2) return [];
  const ctx = await ouvrirContexte({ interventionId: null, appelePar });
  const rows = await lireJournalise<Ligne[]>(ctx, 'res.partner', 'search_read', {
    domain: ['|', ['name', 'ilike', t], ['email', 'ilike', t]],
    fields: ['name', 'email', 'customer_rank'],
    order: 'customer_rank desc, name',
    limit: 10,
  }, { quoi: 'recherche client', texte: t });
  return rows.map(clientDe).filter((c): c is ClientOdoo => c !== null);
}

function nouveauClientDepuis(dossier: DossierCharge): NouveauClient {
  const chiffres = bceChiffres(dossier.client_bce);
  const nomBase = (dossier.client_nom ?? 'Client').trim();
  // Convention Foxo dans Odoo : « ACP PACIFIC – BCE 0850.924.580 ».
  const nom = chiffres && !nomBase.replace(/\D/g, '').includes(chiffres)
    ? `${nomBase} – BCE ${bcePointe(chiffres)}`
    : nomBase;
  const adresse = decouperAdresse(dossier.client_adresse);
  return {
    nom,
    email: texte(dossier.client_email),
    bce: chiffres,
    adresse_ligne1: dossier.client_syndic ?? null,
    adresse_ligne2: adresse.ligne,
    code_postal: adresse.code_postal,
    ville: adresse.ville,
  };
}

// ─── Note sous les lignes ───────────────────────────────────────────────────

function composerNote(dossier: DossierCharge): string {
  const blocs: string[] = [];
  // « RÉF. ETTIK 2026-0846 » : la référence du courtier/syndic, précédée de
  // son nom quand on le connaît.
  if (dossier.reference_externe) blocs.push(`RÉF. ${dossier.reference_externe}`);
  else if (dossier.reference_sinistre) {
    const qui = dossier.assureur_nom ? dossier.assureur_nom.toUpperCase() : 'SINISTRE';
    blocs.push(`RÉF. ${qui} ${dossier.reference_sinistre}`);
  }

  const lieu = [dossier.adresse_intervention, dossier.acp_nom].filter(Boolean).join(' – ');
  if (lieu) blocs.push(lieu);

  const parAppartement = new Map<string, string[]>();
  for (const o of dossier.occupants) {
    const nom = [o.prenom, o.nom].filter(Boolean).join(' ').trim();
    if (!nom) continue;
    const role = o.type_occupant ? TYPE_OCCUPANT_LABEL[o.type_occupant].toLowerCase() : null;
    const cle = texte(o.appartement) ?? '';
    const liste = parAppartement.get(cle) ?? [];
    liste.push(role ? `${nom}, ${role}` : nom);
    parAppartement.set(cle, liste);
  }
  const lignesOccupants: string[] = [];
  for (const [appartement, personnes] of parAppartement) {
    lignesOccupants.push(appartement ? `Appartement ${appartement} : ${personnes.join(' – ')}` : personnes.join(' – '));
  }
  if (lignesOccupants.length > 0) blocs.push(lignesOccupants.join('\n'));

  return blocs.join('\n\n');
}

// ─── Préparation (lecture seule) ────────────────────────────────────────────

export async function preparerBrouillon(interventionId: string, appelePar: string | null): Promise<PreparationBrouillon> {
  const ctx = await ouvrirContexte({ interventionId, appelePar });
  const dossier = await chargerDossier(ctx, interventionId);
  const blocage = await blocagePour(ctx, dossier);
  const catalogue = await lireCatalogue(ctx);

  // Client : miroir (0 appel), puis BCE, puis e-mail.
  let propose: ClientOdoo | null = await clientParMiroir(ctx, dossier);
  let source: PreparationBrouillon['client']['source'] = propose ? 'miroir' : null;
  let candidats: ClientOdoo[] = [];
  if (!propose) {
    candidats = await clientsParBce(ctx, dossier.client_bce);
    if (candidats.length > 0) { propose = candidats[0]; source = 'bce'; }
  }
  if (!propose) {
    candidats = await clientsParEmail(ctx, dossier.client_email);
    if (candidats.length > 0) { propose = candidats[0]; source = 'email'; }
  }

  const produitDefaut = catalogue.produits.find((p) => p.id === catalogue.produitParDefaut) ?? catalogue.produits[0] ?? null;
  const lignes: LigneBrouillon[] = produitDefaut
    ? [{ produit_id: produitDefaut.id, libelle: produitDefaut.nom, quantite: 1, prix_unitaire: produitDefaut.prix, taux_tva: produitDefaut.taux_tva }]
    : [];
  const tauxDisponibles = [...new Set(catalogue.taxes.map((t) => t.taux))].sort((a, b) => b - a);
  const nouveau = nouveauClientDepuis(dossier);
  const hote = odooHost();

  return {
    dossier: { id: dossier.id, ref: dossier.ref, adresse: dossier.adresse_intervention },
    client: { propose, source, candidats, nouveau },
    saisie: {
      partner_id: propose?.id ?? null,
      nouveau_client: propose ? null : nouveau,
      reference: `${dossier.ref} ${rueEtNumero(dossier.adresse_intervention)}`.trim(),
      date_facture: aujourdhuiBruxelles(),
      lignes,
      note: composerNote(dossier) || null,
    },
    catalogue: { produits: catalogue.produits, taux: tauxDisponibles, frequents: catalogue.frequents },
    condition_paiement: catalogue.terme?.nom ?? null,
    communication: generateBBA(dossier.ref),
    blocage,
    ecriture_active: await odooEcritureActive(ctx.admin),
    odoo_url: hote ? `https://${hote}` : null,
  };
}

// ─── Construction des valeurs Odoo ──────────────────────────────────────────

function valsPartner(n: NouveauClient, paysId: number | null): Record<string, unknown> {
  return {
    name: n.nom,
    is_company: true,
    customer_rank: 1,
    lang: 'fr_BE',
    ...(n.email ? { email: n.email } : {}),
    ...(n.adresse_ligne1 ? { street: n.adresse_ligne1 } : {}),
    ...(n.adresse_ligne2 ? { street2: n.adresse_ligne2 } : {}),
    ...(n.code_postal ? { zip: n.code_postal } : {}),
    ...(n.ville ? { city: n.ville } : {}),
    ...(paysId != null ? { country_id: paysId } : {}),
  };
}

function verifierSaisie(s: SaisieBrouillon, catalogue: Catalogue): string | null {
  if (!texte(s.reference)) return 'La référence est vide.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date_facture)) return 'Date de facture invalide (attendu AAAA-MM-JJ).';
  if (s.partner_id == null && !texte(s.nouveau_client?.nom)) return 'Aucun client : choisis un client Odoo ou renseigne le nouveau client.';
  if (!Array.isArray(s.lignes) || s.lignes.length === 0) return 'Au moins une ligne est nécessaire.';
  for (const [i, l] of s.lignes.entries()) {
    if (!texte(l.libelle)) return `Ligne ${i + 1} : libellé vide.`;
    if (!(nombre(l.quantite) > 0)) return `Ligne ${i + 1} : quantité invalide.`;
    if (nombre(l.prix_unitaire) < 0) return `Ligne ${i + 1} : prix négatif.`;
    if (!taxePourTaux(catalogue, nombre(l.taux_tva))) return `Ligne ${i + 1} : aucune taxe de vente à ${l.taux_tva} % dans Odoo.`;
    if (l.produit_id != null && !catalogue.produits.some((p) => p.id === l.produit_id)) return `Ligne ${i + 1} : produit inconnu dans Odoo.`;
  }
  return null;
}

function totaux(lignes: LigneBrouillon[]): { ht: number; tva: number; ttc: number } {
  let ht = 0;
  let tva = 0;
  for (const l of lignes) {
    const base = arrondi(nombre(l.quantite) * nombre(l.prix_unitaire));
    ht += base;
    tva += arrondi(base * nombre(l.taux_tva) / 100);
  }
  ht = arrondi(ht);
  tva = arrondi(tva);
  return { ht, tva, ttc: arrondi(ht + tva) };
}

function valsMove(
  s: SaisieBrouillon,
  partnerId: number,
  catalogue: Catalogue,
  societeOdoo: number,
  communication: string,
): Record<string, unknown> {
  const lignes: unknown[] = s.lignes.map((l) => {
    const taxe = taxePourTaux(catalogue, nombre(l.taux_tva));
    return [0, 0, {
      ...(l.produit_id != null ? { product_id: l.produit_id } : {}),
      name: l.libelle.trim(),
      quantity: nombre(l.quantite),
      price_unit: nombre(l.prix_unitaire),
      tax_ids: [[6, 0, taxe ? [taxe.id] : []]],
    }];
  });
  if (texte(s.note)) lignes.push([0, 0, { display_type: 'line_note', name: s.note!.trim() }]);
  return {
    move_type: 'out_invoice',
    company_id: societeOdoo,
    partner_id: partnerId,
    ref: s.reference.trim(),
    invoice_date: s.date_facture,
    // Communication structurée posée dès le brouillon (cf. en-tête) ; Odoo ne
    // la remplace à la validation que si elle est vide.
    payment_reference: communication,
    ...(catalogue.terme ? { invoice_payment_term_id: catalogue.terme.id } : {}),
    invoice_line_ids: lignes,
  };
}

async function paiementPour(montantTtc: number, communication: string): Promise<PaiementBrouillon> {
  const qr = await generateEpcQrDataUrl({
    beneficiaryName: VENDOR.name,
    iban: VENDOR.iban,
    bic: VENDOR.bic,
    amountEur: montantTtc,
    bba: communication,
  });
  return { iban: VENDOR.iban, beneficiaire: VENDOR.name, montant_ttc: montantTtc, communication, qr_data_url: qr };
}

/** QR de paiement d'un brouillon déjà créé (ré-affichage depuis le bloc du dossier). */
export async function paiementBrouillon(montantTtc: number, communication: string): Promise<PaiementBrouillon> {
  return paiementPour(montantTtc, communication);
}

// ─── Essai à blanc : ce qui serait envoyé, sans rien envoyer ────────────────

export interface EssaiABlanc {
  preparation: PreparationBrouillon;
  enverrait: { res_partner: Record<string, unknown> | null; account_move: Record<string, unknown> };
  totaux: { ht: number; tva: number; ttc: number };
}

export async function essaiABlanc(interventionId: string, appelePar: string | null): Promise<EssaiABlanc> {
  const preparation = await preparerBrouillon(interventionId, appelePar);
  const ctx = await ouvrirContexte({ interventionId, appelePar });
  const catalogue = await lireCatalogue(ctx);
  const s = preparation.saisie;
  const resPartner = s.partner_id == null && s.nouveau_client
    ? valsPartner(s.nouveau_client, await idBelgique(ctx))
    : null;
  // Sans client existant, l'identifiant 0 tient lieu de « celui qui serait créé ».
  const accountMove = valsMove(s, s.partner_id ?? 0, catalogue, ctx.societeOdoo, preparation.communication);
  return { preparation, enverrait: { res_partner: resPartner, account_move: accountMove }, totaux: totaux(s.lignes) };
}

// ─── Création du brouillon (écrit dans Odoo) ────────────────────────────────

export async function creerBrouillonOdoo(
  interventionId: string,
  saisie: SaisieBrouillon,
  appelePar: string | null,
): Promise<ResultatCreation> {
  try {
    const ctx = await ouvrirContexte({ interventionId, appelePar });
    if (!(await odooEcritureActive(ctx.admin))) {
      return { ok: false, erreur: 'Écriture vers Odoo désactivée (réglage odoo_ecriture_active). Rien n\'a été envoyé.' };
    }
    const dossier = await chargerDossier(ctx, interventionId);
    const blocage = await blocagePour(ctx, dossier);
    if (blocage) return { ok: false, erreur: blocage };
    const catalogue = await lireCatalogue(ctx);
    const invalide = verifierSaisie(saisie, catalogue);
    if (invalide) return { ok: false, erreur: invalide };

    // 1. Client : existant, ou créé maintenant.
    let partnerId = saisie.partner_id;
    let partnerNom: string | null = null;
    let partnerCree = false;
    if (partnerId == null && saisie.nouveau_client) {
      const vals = valsPartner(saisie.nouveau_client, await idBelgique(ctx));
      partnerId = await creerJournalise(ctx, 'res.partner', vals, { nom: saisie.nouveau_client.nom, bce: saisie.nouveau_client.bce });
      partnerNom = saisie.nouveau_client.nom;
      partnerCree = true;
    }
    if (partnerId == null) return { ok: false, erreur: 'Aucun client.' };

    // 2. Facture brouillon, avec la communication structurée du dossier.
    const communication = generateBBA(dossier.ref);
    const vals = valsMove(saisie, partnerId, catalogue, ctx.societeOdoo, communication);
    const moveId = await creerJournalise(ctx, 'account.move', vals, {
      dossier: dossier.ref, reference: saisie.reference, partner_id: partnerId, nb_lignes: saisie.lignes.length,
    });

    // 3. Trace FoxO.
    const t = totaux(saisie.lignes);
    const { data: b, error } = await ctx.admin
      .from('odoo_brouillons')
      .insert({
        societe_id: ctx.societeId,
        intervention_id: dossier.id,
        dossier_ref: dossier.ref,
        odoo_move_id: moveId,
        odoo_partner_id: partnerId,
        odoo_partner_nom: partnerNom,
        partner_cree: partnerCree,
        reference: saisie.reference.trim(),
        communication,
        date_facture: saisie.date_facture,
        montant_ht: t.ht,
        montant_tva: t.tva,
        montant_ttc: t.ttc,
        charge: { res_partner: partnerCree ? saisie.nouveau_client : null, account_move: vals },
        cree_par: appelePar,
      })
      .select('id')
      .maybeSingle();
    const brouillonId = (b as { id: string } | null)?.id ?? null;
    if (error || !brouillonId) {
      // Le brouillon EXISTE dans Odoo : on le dit, avec son identifiant.
      return { ok: false, erreur: `Brouillon créé dans Odoo (id ${moveId}) mais non enregistré côté FoxO : ${error?.message ?? 'insertion refusée'}.` };
    }
    await rattacherJournal(ctx, brouillonId);
    const hote = odooHost();
    return {
      ok: true,
      brouillon_id: brouillonId,
      odoo_move_id: moveId,
      odoo_url: hote ? `https://${hote}/web#id=${moveId}&model=account.move&view_type=form` : null,
      partner_cree: partnerCree,
      paiement: await paiementPour(t.ttc, communication),
    };
  } catch (e) {
    return { ok: false, erreur: e instanceof Error ? e.message : 'Erreur Odoo.' };
  }
}
