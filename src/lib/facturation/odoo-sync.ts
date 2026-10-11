// Synchronisation Odoo → FoxO — miroir en LECTURE SEULE.
//
// FoxO recopie dans des tables À PART (odoo_factures, odoo_mouvements_bancaires)
// ce qu'Odoo contient : les factures de vente et d'achat comptabilisées, et les
// mouvements bancaires (= paiements reçus et envoyés). Rien n'est écrit dans
// Odoo, et rien n'est écrit dans les factures FoxO (factures / factures_achat) :
// aucun bouton existant ne peut agir sur ces pièces.
//
// Recopie COMPLÈTE à chaque passage (volumes faibles : quelques centaines de
// pièces par an) : ce qui a disparu d'Odoo disparaît du miroir.
//
// Cadence Odoo : 1 appel par seconde (cf. odoo-read.ts) → lectures par grandes
// pages. Une seule synchronisation à la fois : le journal
// odoo_synchronisations sert de verrou.

import { createAdminClient } from '@/lib/supabase/admin';
import {
  isOdooReadConfigured,
  odooLire,
  odooNombreAppels,
  testerProtocole,
  type OdooMethodeLecture,
  type OdooProtocole,
} from './odoo-read';

const TYPES_FACTURE = ['out_invoice', 'out_refund', 'in_invoice', 'in_refund'];
// Le détail des règlements est calculé par Odoo à la lecture : pages modestes.
const PAGE_FACTURES = 200;
const PAGE_MOUVEMENTS = 1_000;
const PAGES_MAX = 50;
const LOT_ECRITURE = 200;
const LOT_RECHERCHE = 200;
// Un passage « en cours » depuis plus de 10 minutes est considéré comme mort.
const VERROU_MS = 10 * 60_000;

const CHAMPS_FACTURE = [
  'name', 'ref', 'payment_reference', 'partner_id', 'move_type', 'state', 'payment_state',
  'invoice_date', 'invoice_date_due', 'amount_untaxed', 'amount_tax', 'amount_total',
  'amount_residual', 'currency_id', 'company_id', 'invoice_payments_widget', 'write_date',
];
const CHAMPS_MOUVEMENT = [
  'date', 'amount', 'payment_ref', 'partner_id', 'partner_name', 'is_reconciled', 'journal_id',
  'company_id', 'move_id', 'write_date',
];

type Ligne = Record<string, unknown>;
type Admin = ReturnType<typeof createAdminClient>;

export type Declencheur = 'manuel' | 'planifie';

export interface OdooReglement {
  date: string | null;
  montant: number | null;
  journal: string | null;
  /** Écriture du mouvement bancaire — cf. OdooMouvementRow.odoo_move_id. */
  odoo_move_id: number | null;
}

export interface OdooFactureRow {
  societe_id: string | null;
  odoo_id: number;
  odoo_societe_id: number | null;
  sens: 'vente' | 'achat';
  est_note_credit: boolean;
  numero: string | null;
  reference: string | null;
  communication: string | null;
  tiers_nom: string | null;
  odoo_tiers_id: number | null;
  date_facture: string | null;
  date_echeance: string | null;
  montant_ht: number | null;
  montant_tva: number | null;
  montant_ttc: number | null;
  montant_restant: number | null;
  devise: string | null;
  /** Valeur Odoo brute : not_paid, in_payment, paid, partial, reversed… */
  etat_paiement: string;
  reglements: OdooReglement[];
  date_dernier_reglement: string | null;
  dossier_ref: string | null;
  intervention_id: string | null;
  odoo_modifie_le: string | null;
  synchronise_le: string;
}

export interface OdooMouvementRow {
  societe_id: string | null;
  odoo_id: number;
  odoo_move_id: number | null;
  odoo_societe_id: number | null;
  date_mouvement: string;
  /** Positif = paiement reçu, négatif = paiement envoyé. */
  montant: number;
  tiers_nom: string | null;
  communication: string | null;
  journal: string | null;
  rapproche: boolean | null;
  odoo_modifie_le: string | null;
  synchronise_le: string;
}

export type ResultatSync =
  | {
      ok: true;
      factures: number;
      mouvements: number;
      factures_retirees: number;
      mouvements_retires: number;
      dossiers_relies: number;
      nb_appels: number;
      duree_ms: number;
      avertissements: string[];
    }
  | { ok: false; erreur: string };

interface Commun {
  societeId: string | null;
  synchroniseLe: string;
}

// ─── Lecture des valeurs Odoo ───────────────────────────────────────────────
// Odoo renvoie `false` pour un champ vide, et un lien sous la forme d'un
// identifiant, d'une paire [id, nom] ou d'un objet { id, display_name }.

function texte(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function nombre(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function idDe(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (Array.isArray(v) && typeof v[0] === 'number') return v[0];
  if (v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'number') {
    return (v as { id: number }).id;
  }
  return null;
}

function nomDe(v: unknown): string | null {
  if (Array.isArray(v)) return texte(v[1]);
  if (v && typeof v === 'object') {
    const o = v as { display_name?: unknown; name?: unknown };
    return texte(o.display_name) ?? texte(o.name);
  }
  return null;
}

function jour(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

// Odoo date ses modifications en UTC, sans fuseau (« 2026-10-09 12:34:56 »).
function horodatage(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(v)
    ? `${v.slice(0, 19).replace(' ', 'T')}Z`
    : v;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ─── Mapping (fonctions pures) ──────────────────────────────────────────────

/**
 * Numéro de dossier FoxO en tête de la référence Odoo :
 * « 2026-221 Rue du Noyer 296 » → « 2026-221 ». Même format que les
 * références d'intervention ({année}-{numéro}, cf. intervention-ref.ts).
 * Sert de SECOURS : le numéro de facture fait foi (extraireDossierNumero).
 */
export function extraireDossierRef(reference: string | null): string | null {
  const m = (reference ?? '').match(/^\s*(\d{4}-\d+)(?!\d)/);
  return m ? m[1] : null;
}

/**
 * Numéro de dossier FoxO porté par le NUMÉRO de la facture de vente : la
 * facture reprend le numéro du dossier, précédé de lettres
 * (« FV2026-001 » → « 2026-001 »). Règle métier confirmée par Foxo.
 */
export function extraireDossierNumero(numero: string | null): string | null {
  const m = (numero ?? '').match(/^[^\d]*(\d{4}-\d+)$/);
  return m ? m[1] : null;
}

function lireReglements(widget: unknown): OdooReglement[] {
  if (!widget || typeof widget !== 'object') return [];
  const content = (widget as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  return content.map((c) => {
    const r = (c ?? {}) as Ligne;
    return {
      date: jour(r.date),
      montant: nombre(r.amount),
      journal: texte(r.journal_name),
      odoo_move_id: idDe(r.move_id),
    };
  });
}

export function mapperFacture(
  r: Ligne,
  nomsTiers: Map<number, string>,
  commun: Commun,
): OdooFactureRow | null {
  const odooId = idDe(r.id);
  const type = texte(r.move_type);
  if (odooId == null || !type || !TYPES_FACTURE.includes(type)) return null;

  const sens = type.startsWith('out_') ? 'vente' : 'achat';
  const estNoteCredit = type.endsWith('_refund');
  const numero = texte(r.name);
  const reference = texte(r.ref);
  // Lien avec le dossier (ventes uniquement) : le numéro de facture fait foi ;
  // la référence sert de secours. Le numéro d'une note de crédit n'est pas un
  // numéro de dossier : seule sa référence est lue.
  const dossierRef = sens === 'vente'
    ? (estNoteCredit ? null : extraireDossierNumero(numero)) ?? extraireDossierRef(reference)
    : null;
  const reglements = lireReglements(r.invoice_payments_widget);
  const datesReglement = reglements
    .map((x) => x.date)
    .filter((d): d is string => d !== null)
    .sort();
  const tiersId = idDe(r.partner_id);

  return {
    societe_id: commun.societeId,
    odoo_id: odooId,
    odoo_societe_id: idDe(r.company_id),
    sens,
    est_note_credit: estNoteCredit,
    numero,
    reference,
    communication: texte(r.payment_reference),
    tiers_nom: nomDe(r.partner_id) ?? (tiersId != null ? nomsTiers.get(tiersId) ?? null : null),
    odoo_tiers_id: tiersId,
    date_facture: jour(r.invoice_date),
    date_echeance: jour(r.invoice_date_due),
    montant_ht: nombre(r.amount_untaxed),
    montant_tva: nombre(r.amount_tax),
    montant_ttc: nombre(r.amount_total),
    montant_restant: nombre(r.amount_residual),
    devise: nomDe(r.currency_id),
    etat_paiement: texte(r.payment_state) ?? 'inconnu',
    reglements,
    date_dernier_reglement: datesReglement.length > 0 ? datesReglement[datesReglement.length - 1] : null,
    dossier_ref: dossierRef,
    intervention_id: null,
    odoo_modifie_le: horodatage(r.write_date),
    synchronise_le: commun.synchroniseLe,
  };
}

export function mapperMouvement(
  r: Ligne,
  nomsTiers: Map<number, string>,
  commun: Commun,
): OdooMouvementRow | null {
  const odooId = idDe(r.id);
  const date = jour(r.date);
  const montant = nombre(r.amount);
  if (odooId == null || !date || montant == null) return null;
  const tiersId = idDe(r.partner_id);

  return {
    societe_id: commun.societeId,
    odoo_id: odooId,
    odoo_move_id: idDe(r.move_id),
    odoo_societe_id: idDe(r.company_id),
    date_mouvement: date,
    montant,
    tiers_nom:
      nomDe(r.partner_id)
      ?? (tiersId != null ? nomsTiers.get(tiersId) ?? null : null)
      ?? texte(r.partner_name),
    communication: texte(r.payment_ref),
    journal: nomDe(r.journal_id),
    rapproche: typeof r.is_reconciled === 'boolean' ? r.is_reconciled : null,
    odoo_modifie_le: horodatage(r.write_date),
    synchronise_le: commun.synchroniseLe,
  };
}

// ─── Réglages ───────────────────────────────────────────────────────────────

interface Reglages {
  societeOdoo: number;
  depuis: string;
  active: boolean;
}

async function lireReglages(admin: Admin): Promise<Reglages> {
  const { data, error } = await admin
    .from('parametres')
    .select('cle, valeur')
    .in('cle', ['odoo_lecture_societe_id', 'odoo_lecture_depuis', 'odoo_lecture_active']);
  if (error) throw new Error(`Réglages Odoo illisibles : ${error.message}`);
  const valeurs = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ cle: string; valeur: string | null }>) {
    valeurs.set(row.cle, (row.valeur ?? '').trim());
  }
  const societeOdoo = Number(valeurs.get('odoo_lecture_societe_id'));
  const depuis = valeurs.get('odoo_lecture_depuis') ?? '';
  if (!Number.isInteger(societeOdoo) || societeOdoo <= 0) {
    throw new Error('Réglage odoo_lecture_societe_id absent ou invalide (migration non appliquée ?).');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(depuis)) {
    throw new Error('Réglage odoo_lecture_depuis absent ou invalide (attendu : AAAA-MM-JJ).');
  }
  return { societeOdoo, depuis, active: valeurs.get('odoo_lecture_active') === 'true' };
}

/** Le passage NOCTURNE n'a lieu que si cet interrupteur est allumé. */
export async function odooLectureActive(): Promise<boolean> {
  try {
    return (await lireReglages(createAdminClient())).active;
  } catch {
    return false;
  }
}

async function premiereSociete(admin: Admin): Promise<string | null> {
  const { data } = await admin
    .from('societes')
    .select('id')
    .eq('actif', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

// ─── Lecture Odoo ───────────────────────────────────────────────────────────

type Lire = <T>(model: string, method: OdooMethodeLecture, named: Record<string, unknown>) => Promise<T>;

async function choisirProtocole(): Promise<OdooProtocole> {
  try {
    await testerProtocole('json2');
    return 'json2';
  } catch {
    await testerProtocole('jsonrpc');
    return 'jsonrpc';
  }
}

async function lireTout(
  lire: Lire,
  model: string,
  domain: unknown[],
  fields: string[],
  page: number,
): Promise<{ lignes: Ligne[]; tronque: boolean }> {
  const lignes: Ligne[] = [];
  for (let i = 0; i < PAGES_MAX; i += 1) {
    const lot = await lire<Ligne[]>(model, 'search_read', {
      domain,
      fields,
      limit: page,
      offset: i * page,
      order: 'id asc',
    });
    lignes.push(...lot);
    if (lot.length < page) return { lignes, tronque: false };
  }
  return { lignes, tronque: true };
}

// Noms des tiers quand Odoo n'a renvoyé que leur identifiant.
async function nomsDesTiers(lire: Lire, lignes: Ligne[]): Promise<Map<number, string>> {
  const manquants = new Set<number>();
  for (const r of lignes) {
    const id = idDe(r.partner_id);
    if (id != null && nomDe(r.partner_id) === null) manquants.add(id);
  }
  const noms = new Map<number, string>();
  const ids = [...manquants];
  for (let i = 0; i < ids.length; i += LOT_RECHERCHE) {
    const lot = ids.slice(i, i + LOT_RECHERCHE);
    const rows = await lire<Ligne[]>('res.partner', 'search_read', {
      domain: [['id', 'in', lot]],
      fields: ['name'],
      limit: lot.length,
      context: { active_test: false },
    });
    for (const p of rows) {
      const id = idDe(p.id);
      const nom = texte(p.name);
      if (id != null && nom) noms.set(id, nom);
    }
  }
  return noms;
}

// ─── Écriture du miroir ─────────────────────────────────────────────────────

async function relierDossiers(admin: Admin, factures: OdooFactureRow[]): Promise<number> {
  const refs = [...new Set(factures.map((f) => f.dossier_ref).filter((r): r is string => r !== null))];
  const idParRef = new Map<string, string>();
  for (let i = 0; i < refs.length; i += LOT_RECHERCHE) {
    const { data, error } = await admin
      .from('interventions')
      .select('id, ref')
      .in('ref', refs.slice(i, i + LOT_RECHERCHE))
      .is('deleted_at', null);
    if (error) throw new Error(`Lecture des dossiers : ${error.message}`);
    for (const row of (data ?? []) as Array<{ id: string; ref: string | null }>) {
      if (row.ref && !idParRef.has(row.ref)) idParRef.set(row.ref, row.id);
    }
  }
  let relies = 0;
  for (const f of factures) {
    const id = f.dossier_ref ? idParRef.get(f.dossier_ref) : undefined;
    if (id) {
      f.intervention_id = id;
      relies += 1;
    }
  }
  return relies;
}

async function ecrire(admin: Admin, table: string, rows: object[]): Promise<void> {
  for (let i = 0; i < rows.length; i += LOT_ECRITURE) {
    const { error } = await admin
      .from(table)
      .upsert(rows.slice(i, i + LOT_ECRITURE), { onConflict: 'odoo_id' });
    if (error) throw new Error(`Écriture ${table} : ${error.message}`);
  }
}

// Retire du miroir ce que ce passage n'a pas revu (pièce supprimée, annulée ou
// repassée en brouillon dans Odoo).
async function retirerDisparus(admin: Admin, table: string, synchroniseLe: string): Promise<number> {
  const { data, error } = await admin
    .from(table)
    .delete()
    .lt('synchronise_le', synchroniseLe)
    .select('id');
  if (error) throw new Error(`Nettoyage ${table} : ${error.message}`);
  return (data ?? []).length;
}

interface Bilan {
  factures: number;
  mouvements: number;
  factures_retirees: number;
  mouvements_retires: number;
  dossiers_relies: number;
  avertissements: string[];
}

async function executer(admin: Admin, reglages: Reglages, commun: Commun): Promise<Bilan> {
  const protocole = await choisirProtocole();
  const lire: Lire = (model, method, named) => odooLire(protocole, model, method, named);
  const avertissements: string[] = [];

  const lectureFactures = await lireTout(
    lire,
    'account.move',
    [
      ['company_id', '=', reglages.societeOdoo],
      ['move_type', 'in', TYPES_FACTURE],
      ['state', '=', 'posted'],
      ['invoice_date', '>=', reglages.depuis],
    ],
    CHAMPS_FACTURE,
    PAGE_FACTURES,
  );
  const lectureMouvements = await lireTout(
    lire,
    'account.bank.statement.line',
    [
      ['company_id', '=', reglages.societeOdoo],
      ['date', '>=', reglages.depuis],
    ],
    CHAMPS_MOUVEMENT,
    PAGE_MOUVEMENTS,
  );

  const nomsTiers = await nomsDesTiers(lire, [...lectureFactures.lignes, ...lectureMouvements.lignes]);

  const factures = lectureFactures.lignes
    .map((r) => mapperFacture(r, nomsTiers, commun))
    .filter((f): f is OdooFactureRow => f !== null);
  const mouvements = lectureMouvements.lignes
    .map((r) => mapperMouvement(r, nomsTiers, commun))
    .filter((m): m is OdooMouvementRow => m !== null);

  // Numéro et référence qui ne désignent pas le même dossier : on le signale.
  const desaccords = factures
    .filter((f) => {
      if (f.sens !== 'vente' || f.est_note_credit) return false;
      const parNumero = extraireDossierNumero(f.numero);
      const parReference = extraireDossierRef(f.reference);
      return parNumero !== null && parReference !== null && parNumero !== parReference;
    })
    .map((f) => f.numero ?? String(f.odoo_id));
  if (desaccords.length > 0) {
    const extrait = desaccords.slice(0, 10).join(', ');
    avertissements.push(
      `Numéro et référence en désaccord sur ${desaccords.length} facture(s) — le numéro fait foi : ${extrait}${desaccords.length > 10 ? '…' : ''}.`,
    );
  }

  const dossiersRelies = await relierDossiers(admin, factures);

  await ecrire(admin, 'odoo_factures', factures);
  await ecrire(admin, 'odoo_mouvements_bancaires', mouvements);

  // On ne retire rien sur la foi d'une lecture incomplète ou vide.
  let facturesRetirees = 0;
  if (lectureFactures.tronque) {
    avertissements.push('Factures : lecture incomplète (plafond atteint) — rien retiré.');
  } else if (factures.length === 0) {
    avertissements.push('Factures : lecture vide — rien retiré.');
  } else {
    facturesRetirees = await retirerDisparus(admin, 'odoo_factures', commun.synchroniseLe);
  }
  let mouvementsRetires = 0;
  if (lectureMouvements.tronque) {
    avertissements.push('Mouvements bancaires : lecture incomplète (plafond atteint) — rien retiré.');
  } else if (mouvements.length === 0) {
    avertissements.push('Mouvements bancaires : lecture vide — rien retiré.');
  } else {
    mouvementsRetires = await retirerDisparus(admin, 'odoo_mouvements_bancaires', commun.synchroniseLe);
  }

  return {
    factures: factures.length,
    mouvements: mouvements.length,
    factures_retirees: facturesRetirees,
    mouvements_retires: mouvementsRetires,
    dossiers_relies: dossiersRelies,
    avertissements,
  };
}

// ─── API publique ───────────────────────────────────────────────────────────

/**
 * Recopie Odoo dans le miroir FoxO. Ne throw jamais : { ok, … } et une ligne
 * dans le journal odoo_synchronisations (ok ou erreur).
 */
export async function synchroniserOdoo(
  declencheur: Declencheur,
  lancePar: string | null,
): Promise<ResultatSync> {
  if (!isOdooReadConfigured()) {
    return { ok: false, erreur: 'Clés Odoo absentes côté serveur.' };
  }
  const debut = Date.now();
  const synchroniseLe = new Date(debut).toISOString();
  const appelsAvant = odooNombreAppels();

  let admin: Admin;
  let reglages: Reglages;
  try {
    admin = createAdminClient();
    reglages = await lireReglages(admin);
  } catch (e) {
    return { ok: false, erreur: message(e) };
  }

  // Verrou : un seul passage à la fois (la cadence Odoo ne tolère pas deux
  // lectures simultanées).
  const { data: enCours, error: erreurVerrou } = await admin
    .from('odoo_synchronisations')
    .select('id')
    .eq('statut', 'en_cours')
    .gte('demarree_le', new Date(debut - VERROU_MS).toISOString())
    .limit(1);
  if (erreurVerrou) {
    return { ok: false, erreur: `Journal de synchronisation illisible : ${erreurVerrou.message}` };
  }
  if (enCours && enCours.length > 0) {
    return { ok: false, erreur: 'Une synchronisation Odoo est déjà en cours. Réessayez dans quelques minutes.' };
  }

  const societeId = await premiereSociete(admin);
  const { data: journal, error: erreurJournal } = await admin
    .from('odoo_synchronisations')
    .insert({
      societe_id: societeId,
      demarree_le: synchroniseLe,
      declencheur,
      statut: 'en_cours',
      lance_par: lancePar,
    })
    .select('id')
    .single();
  if (erreurJournal || !journal) {
    return { ok: false, erreur: `Journal de synchronisation : ${erreurJournal?.message ?? 'écriture refusée'}` };
  }
  const journalId = journal.id as string;
  const mesure = () => ({
    terminee_le: new Date().toISOString(),
    nb_appels: odooNombreAppels() - appelsAvant,
    duree_ms: Date.now() - debut,
  });

  try {
    const bilan = await executer(admin, reglages, { societeId, synchroniseLe });
    const fin = mesure();
    await admin
      .from('odoo_synchronisations')
      .update({ statut: 'ok', nb_factures: bilan.factures, nb_mouvements: bilan.mouvements, ...fin })
      .eq('id', journalId);
    return { ok: true, ...bilan, nb_appels: fin.nb_appels, duree_ms: fin.duree_ms };
  } catch (e) {
    const erreur = message(e).slice(0, 500);
    await admin
      .from('odoo_synchronisations')
      .update({ statut: 'erreur', erreur, ...mesure() })
      .eq('id', journalId);
    return { ok: false, erreur };
  }
}

export interface EtatSynchronisation {
  nocturne_active: boolean;
  factures: number;
  mouvements: number;
  derniers_passages: Ligne[];
}

/** État du miroir : volumes et derniers passages (lecture seule). */
export async function etatSynchronisation(): Promise<EtatSynchronisation> {
  const admin = createAdminClient();
  const compter = async (table: string): Promise<number> => {
    const { count, error } = await admin.from(table).select('id', { count: 'exact', head: true });
    if (error) throw new Error(`Lecture ${table} : ${error.message}`);
    return count ?? 0;
  };
  const { data, error } = await admin
    .from('odoo_synchronisations')
    .select('demarree_le, terminee_le, declencheur, statut, nb_factures, nb_mouvements, nb_appels, duree_ms, erreur')
    .order('demarree_le', { ascending: false })
    .limit(5);
  if (error) throw new Error(`Lecture odoo_synchronisations : ${error.message}`);
  return {
    nocturne_active: await odooLectureActive(),
    factures: await compter('odoo_factures'),
    mouvements: await compter('odoo_mouvements_bancaires'),
    derniers_passages: (data ?? []) as Ligne[],
  };
}
