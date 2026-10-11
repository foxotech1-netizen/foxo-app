// Lecture Odoo — client en LECTURE SEULE (chantier « Odoo visible dans FoxO »).
//
// Sens inverse du connecteur de push (odoo.ts) : ici FoxO LIT Odoo et n'y
// écrit jamais. Garanti par construction : seules les méthodes listées dans
// METHODES_LECTURE peuvent partir sur le réseau.
//
// Indépendant de parametres.odoo_sync_enabled : cet interrupteur gouverne le
// PUSH FoxO → Odoo et doit pouvoir rester éteint pendant qu'on lit.
//
// Deux protocoles, départagés au branchement réel :
//   - JSON-2 (Odoo 19+) : POST <ODOO_URL>/json/2/<modèle>/<méthode>, clé API
//     en « Authorization: bearer », arguments nommés dans le corps.
//   - JSON-RPC (historique, déprécié par Odoo à partir de la 19) :
//     POST <ODOO_URL>/jsonrpc, common.authenticate puis object.execute_kw.
// Les deux reçoivent les mêmes arguments NOMMÉS (domain, fields, limit…).
//
// Cadence : Odoo en ligne n'accepte qu'UN appel par seconde, jamais en
// parallèle (odoo.com/acceptable-use) ; au-delà il répond HTTP 429. Tous les
// appels passent donc par une file unique, espacés, avec nouvelle tentative
// sur 429. Conséquence pour l'appelant : préférer peu d'appels qui ramènent
// beaucoup de lignes à beaucoup de petits appels.
//
// Aucune dépendance (fetch natif), aucun accès base : fichier autonome.

const METHODES_LECTURE = ['search_read', 'search_count', 'fields_get'] as const;
export type OdooMethodeLecture = (typeof METHODES_LECTURE)[number];
export type OdooProtocole = 'json2' | 'jsonrpc';

const TIMEOUT_MS = 20_000;
const MODELE_VALIDE = /^[a-z0-9_.]+$/;
// Un peu plus d'une seconde entre deux départs d'appel.
const INTERVALLE_MS = 1_100;
// Sur HTTP 429 : 1 appel + 2 nouvelles tentatives, attente plafonnée.
const ESSAIS_429 = 3;
const ATTENTE_429_MAX_MS = 5_000;

function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

export function isOdooReadConfigured(): boolean {
  return Boolean(env('ODOO_URL') && env('ODOO_DB') && env('ODOO_USER') && env('ODOO_API_KEY'));
}

// Tolère une adresse saisie sans « https:// » ou avec un chemin collé depuis
// le navigateur : on ne garde que l'origine (https://exemple.odoo.com).
function baseUrl(): string {
  const raw = env('ODOO_URL');
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    throw new Error('ODOO_URL illisible (attendu : https://<nom>.odoo.com).');
  }
}

/** Hôte Odoo pour affichage (jamais de secret). */
export function odooHost(): string | null {
  try {
    return new URL(baseUrl()).host;
  } catch {
    return null;
  }
}

// ─── File d'attente : un appel à la fois, espacés ───────────────────────────
// État propre à l'instance serveur : deux exécutions simultanées sur deux
// instances ne se voient pas — ne jamais lancer deux lectures Odoo en même
// temps (un seul bouton, une seule tâche planifiée).

let file: Promise<unknown> = Promise.resolve();
let dernierDepart = 0;
let compteurAppels = 0;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function enFile<T>(fn: () => Promise<T>): Promise<T> {
  const tour = file.then(async () => {
    const attente = dernierDepart + INTERVALLE_MS - Date.now();
    if (attente > 0) await pause(attente);
    dernierDepart = Date.now();
    compteurAppels += 1;
    return fn();
  });
  file = tour.catch(() => undefined);
  return tour;
}

/** Nombre d'appels réseau partis vers Odoo depuis le démarrage du serveur. */
export function odooNombreAppels(): number {
  return compteurAppels;
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: unknown }> {
  const envoyer = () =>
    enFile(() =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
        body: JSON.stringify(body),
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }),
    );

  let res = await envoyer();
  for (let essai = 1; res.status === 429 && essai < ESSAIS_429; essai += 1) {
    await res.text().catch(() => '');
    const retryAfter = Number(res.headers.get('retry-after'));
    const attente = retryAfter > 0 ? retryAfter * 1_000 : 2_000 * essai;
    await pause(Math.min(attente, ATTENTE_429_MAX_MS));
    res = await envoyer();
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

// ─── JSON-RPC ───────────────────────────────────────────────────────────────

interface JsonRpcEnvelope {
  result?: unknown;
  error?: { message?: string; data?: { message?: string } };
}

async function jsonRpc(service: string, method: string, args: unknown[]): Promise<unknown> {
  const { status, json } = await postJson(`${baseUrl()}/jsonrpc`, {
    jsonrpc: '2.0',
    method: 'call',
    params: { service, method, args },
    id: 1,
  });
  if (status < 200 || status >= 300) throw new Error(`Odoo HTTP ${status} (JSON-RPC)`);
  const envelope = json as JsonRpcEnvelope | null;
  if (!envelope) throw new Error('Réponse Odoo illisible (JSON-RPC).');
  if (envelope.error) {
    throw new Error(envelope.error.data?.message ?? envelope.error.message ?? 'Erreur Odoo.');
  }
  return envelope.result;
}

// L'identifiant utilisateur est mémorisé le temps de vie du serveur, et
// invalidé si l'une des quatre clés change.
let uidCache: { empreinte: string; uid: number } | null = null;

async function authenticate(): Promise<number> {
  const empreinte = [baseUrl(), env('ODOO_DB'), env('ODOO_USER'), env('ODOO_API_KEY')].join('|');
  if (uidCache && uidCache.empreinte === empreinte) return uidCache.uid;
  const uid = await jsonRpc('common', 'authenticate', [
    env('ODOO_DB'),
    env('ODOO_USER'),
    env('ODOO_API_KEY'),
    {},
  ]);
  if (typeof uid !== 'number' || uid <= 0) {
    throw new Error('Authentification Odoo refusée (vérifier ODOO_DB, ODOO_USER et ODOO_API_KEY).');
  }
  uidCache = { empreinte, uid };
  return uid;
}

// ─── JSON-2 ─────────────────────────────────────────────────────────────────

async function json2(model: string, method: string, named: Record<string, unknown>): Promise<unknown> {
  const { status, json } = await postJson(`${baseUrl()}/json/2/${model}/${method}`, named, {
    Authorization: `bearer ${env('ODOO_API_KEY')}`,
    'X-Odoo-Database': env('ODOO_DB'),
  });
  if (status >= 200 && status < 300) return json;
  const err = json as { message?: string } | null;
  throw new Error(err?.message ? `${err.message} (HTTP ${status})` : `Odoo HTTP ${status} (JSON-2)`);
}

// ─── API publique ───────────────────────────────────────────────────────────

/**
 * Appel de LECTURE vers Odoo. Refuse tout ce qui n'est pas une méthode de
 * lecture — aucune écriture ne peut sortir de ce fichier.
 */
export async function odooLire<T = unknown>(
  protocole: OdooProtocole,
  model: string,
  method: OdooMethodeLecture,
  named: Record<string, unknown> = {},
): Promise<T> {
  if (!(METHODES_LECTURE as readonly string[]).includes(method)) {
    throw new Error(`Méthode Odoo refusée (lecture seule) : ${String(method)}`);
  }
  if (!MODELE_VALIDE.test(model)) throw new Error(`Modèle Odoo invalide : ${model}`);
  if (!isOdooReadConfigured()) throw new Error('Clés Odoo absentes côté serveur.');

  if (protocole === 'json2') {
    return (await json2(model, method, named)) as T;
  }
  const uid = await authenticate();
  return (await jsonRpc('object', 'execute_kw', [
    env('ODOO_DB'),
    uid,
    env('ODOO_API_KEY'),
    model,
    method,
    [],
    named,
  ])) as T;
}

/** Vérifie qu'un protocole répond avec les clés fournies (throw sinon). */
export async function testerProtocole(protocole: OdooProtocole): Promise<void> {
  const n = await odooLire<unknown>(protocole, 'res.company', 'search_count', { domain: [] });
  if (typeof n !== 'number') throw new Error('Réponse inattendue au test de connexion.');
}

export interface OdooVersion {
  server_version: string | null;
  server_serie: string | null;
  via: 'jsonrpc' | 'web';
}

function lireVersion(raw: unknown, via: OdooVersion['via']): OdooVersion {
  const v = (raw ?? {}) as { server_version?: unknown; server_serie?: unknown };
  return {
    server_version: typeof v.server_version === 'string' ? v.server_version : null,
    server_serie: typeof v.server_serie === 'string' ? v.server_serie : null,
    via,
  };
}

/** Version du serveur Odoo — information publique, sans authentification. */
export async function odooVersion(): Promise<OdooVersion> {
  try {
    return lireVersion(await jsonRpc('common', 'version', []), 'jsonrpc');
  } catch {
    // Repli : route web publique au même contenu (si /jsonrpc a été retiré).
    const { status, json } = await postJson(`${baseUrl()}/web/webclient/version_info`, {
      jsonrpc: '2.0',
      method: 'call',
      params: {},
      id: 1,
    });
    if (status < 200 || status >= 300) throw new Error(`Version Odoo indisponible (HTTP ${status}).`);
    return lireVersion((json as JsonRpcEnvelope | null)?.result, 'web');
  }
}
