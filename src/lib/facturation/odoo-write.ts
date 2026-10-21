// Écriture Odoo — porte d'ÉCRITURE (chantier « brouillon Odoo depuis FoxO »).
//
// Ce que cette porte autorise, et rien d'autre :
//   - lectures préparatoires : search_read, search_count (via le transport) ;
//   - écritures : create sur res.partner (fiche client) et sur account.move
//     (facture de vente en BROUILLON). Jamais de validation, jamais de
//     modification, jamais de suppression : Foxo fait tout cela dans Odoo.
//
// Deux garde-fous :
//   1. parametres.odoo_ecriture_active doit valoir 'true' pour qu'une
//      écriture parte (les lectures restent possibles, pour l'essai à blanc) ;
//   2. CHAQUE appel passant par ici, lecture ou écriture, réussi ou non, est
//      journalisé dans odoo_appels (modèle, méthode, résumé sans secret,
//      résultat ou erreur, durée).
//
// La plomberie (file d'attente à un appel par seconde, protocoles) est celle
// de odoo-transport.ts, partagée avec la lecture.

import { createAdminClient } from '@/lib/supabase/admin';
import { odooAppel, type OdooProtocole } from './odoo-transport';
import { isOdooReadConfigured, testerProtocole } from './odoo-read';

type Admin = ReturnType<typeof createAdminClient>;

const LECTURES = new Set(['search_read', 'search_count']);
const ECRITURES = new Set(['res.partner/create', 'account.move/create']);
// Le protocole qui répond est mémorisé dix minutes : un test de moins par flux.
const PROTOCOLE_TTL_MS = 10 * 60_000;

export interface ContexteOdoo {
  admin: Admin;
  protocole: OdooProtocole;
  /** societes.id FoxO (première société active), pour les tables FoxO. */
  societeId: string | null;
  /** Société Odoo (parametres.odoo_lecture_societe_id, 1 = Fox Group). */
  societeOdoo: number;
  interventionId: string | null;
  appelePar: string | null;
  /** Identifiants odoo_appels créés dans ce flux (rattachés au brouillon à la fin). */
  journalIds: string[];
}

let protocoleCache: { protocole: OdooProtocole; expire: number } | null = null;

async function choisirProtocole(): Promise<OdooProtocole> {
  if (protocoleCache && protocoleCache.expire > Date.now()) return protocoleCache.protocole;
  let protocole: OdooProtocole;
  try {
    await testerProtocole('json2');
    protocole = 'json2';
  } catch {
    await testerProtocole('jsonrpc');
    protocole = 'jsonrpc';
  }
  protocoleCache = { protocole, expire: Date.now() + PROTOCOLE_TTL_MS };
  return protocole;
}

async function lireParametre(admin: Admin, cle: string): Promise<string> {
  const { data } = await admin.from('parametres').select('valeur').eq('cle', cle).maybeSingle();
  return ((data as { valeur: string | null } | null)?.valeur ?? '').trim();
}

/** L'interrupteur d'écriture : tant qu'il est éteint, rien ne part vers Odoo. */
export async function odooEcritureActive(admin: Admin = createAdminClient()): Promise<boolean> {
  return (await lireParametre(admin, 'odoo_ecriture_active')) === 'true';
}

/** Prépare un flux : protocole, sociétés, auteur. Aucune écriture ici. */
export async function ouvrirContexte(args: {
  interventionId: string | null;
  appelePar: string | null;
}): Promise<ContexteOdoo> {
  if (!isOdooReadConfigured()) {
    throw new Error('Clés Odoo absentes côté serveur (ODOO_URL, ODOO_DB, ODOO_USER, ODOO_API_KEY dans Vercel).');
  }
  const admin = createAdminClient();
  const societeOdooBrut = Number(await lireParametre(admin, 'odoo_lecture_societe_id'));
  const societeOdoo = Number.isInteger(societeOdooBrut) && societeOdooBrut > 0 ? societeOdooBrut : 1;
  const { data: societe } = await admin
    .from('societes')
    .select('id')
    .eq('actif', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return {
    admin,
    protocole: await choisirProtocole(),
    societeId: ((societe as { id: string } | null)?.id) ?? null,
    societeOdoo,
    interventionId: args.interventionId,
    appelePar: args.appelePar,
    journalIds: [],
  };
}

// ─── Journal ────────────────────────────────────────────────────────────────

interface EntreeJournal {
  modele: string;
  methode: string;
  sens: 'lecture' | 'ecriture';
  resume: Record<string, unknown>;
  ok: boolean;
  resultat: string | null;
  erreur: string | null;
  duree_ms: number;
}

async function journaliser(ctx: ContexteOdoo, e: EntreeJournal): Promise<void> {
  try {
    const { data } = await ctx.admin
      .from('odoo_appels')
      .insert({
        societe_id: ctx.societeId,
        intervention_id: ctx.interventionId,
        modele: e.modele,
        methode: e.methode,
        sens: e.sens,
        resume: e.resume,
        ok: e.ok,
        resultat: e.resultat,
        erreur: e.erreur,
        duree_ms: e.duree_ms,
        appele_par: ctx.appelePar,
      })
      .select('id')
      .maybeSingle();
    const id = (data as { id: string } | null)?.id;
    if (id) ctx.journalIds.push(id);
  } catch {
    // Le journal ne doit jamais faire échouer le flux lui-même.
  }
}

/** Rattache au brouillon les entrées de journal écrites pendant le flux. */
export async function rattacherJournal(ctx: ContexteOdoo, brouillonId: string): Promise<void> {
  if (ctx.journalIds.length === 0) return;
  try {
    await ctx.admin.from('odoo_appels').update({ brouillon_id: brouillonId }).in('id', ctx.journalIds);
  } catch {
    // Idem : best-effort.
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ─── Lecture journalisée ────────────────────────────────────────────────────

/**
 * Lecture préparatoire (recherche d'un client, catalogue, taxes…). Passe par
 * le transport commun et laisse une trace dans odoo_appels.
 */
export async function lireJournalise<T>(
  ctx: ContexteOdoo,
  model: string,
  method: 'search_read' | 'search_count',
  named: Record<string, unknown>,
  resume: Record<string, unknown>,
): Promise<T> {
  if (!LECTURES.has(method)) throw new Error(`Méthode de lecture refusée : ${method}`);
  const debut = Date.now();
  try {
    const resultat = await odooAppel<T>(ctx.protocole, model, method, named);
    const nb = Array.isArray(resultat) ? resultat.length : typeof resultat === 'number' ? resultat : null;
    await journaliser(ctx, {
      modele: model, methode: method, sens: 'lecture', resume, ok: true,
      resultat: nb === null ? null : `${nb} ligne(s)`, erreur: null, duree_ms: Date.now() - debut,
    });
    return resultat;
  } catch (e) {
    await journaliser(ctx, {
      modele: model, methode: method, sens: 'lecture', resume, ok: false,
      resultat: null, erreur: message(e), duree_ms: Date.now() - debut,
    });
    throw e;
  }
}

// ─── Écriture journalisée ───────────────────────────────────────────────────

function idCree(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'number') return raw[0];
  if (raw && typeof raw === 'object' && typeof (raw as { id?: unknown }).id === 'number') {
    return (raw as { id: number }).id;
  }
  throw new Error('Odoo n\'a pas renvoyé l\'identifiant de l\'enregistrement créé.');
}

/**
 * Crée UN enregistrement dans Odoo (res.partner ou account.move). Refuse tout
 * autre modèle, et refuse tout si l'interrupteur d'écriture est éteint.
 * Renvoie l'identifiant Odoo créé.
 */
export async function creerJournalise(
  ctx: ContexteOdoo,
  model: 'res.partner' | 'account.move',
  vals: Record<string, unknown>,
  resume: Record<string, unknown>,
): Promise<number> {
  if (!ECRITURES.has(`${model}/create`)) throw new Error(`Écriture Odoo refusée : ${model}`);
  if (!(await odooEcritureActive(ctx.admin))) {
    throw new Error('Écriture vers Odoo désactivée (réglage odoo_ecriture_active). Rien n\'a été envoyé.');
  }
  const debut = Date.now();
  try {
    const raw = await odooAppel<unknown>(ctx.protocole, model, 'create', {
      vals_list: [vals],
      context: { allowed_company_ids: [ctx.societeOdoo] },
    });
    const id = idCree(raw);
    await journaliser(ctx, {
      modele: model, methode: 'create', sens: 'ecriture', resume, ok: true,
      resultat: `id ${id}`, erreur: null, duree_ms: Date.now() - debut,
    });
    return id;
  } catch (e) {
    await journaliser(ctx, {
      modele: model, methode: 'create', sens: 'ecriture', resume, ok: false,
      resultat: null, erreur: message(e), duree_ms: Date.now() - debut,
    });
    throw e;
  }
}
