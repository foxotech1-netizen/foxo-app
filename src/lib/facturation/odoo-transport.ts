// Transport Odoo — plomberie commune à la LECTURE (odoo-read.ts) et à
// l'ÉCRITURE (odoo-write.ts). NE PAS APPELER DIRECTEMENT depuis le reste du
// code : chaque porte (lecture / écriture) impose sa propre liste de méthodes
// autorisées ; ce fichier ne juge pas ce qu'il transporte.
//
// Pourquoi un transport unique : Odoo en ligne n'accepte qu'UN appel par
// seconde, jamais en parallèle (odoo.com/acceptable-use), sinon HTTP 429. La
// file d'attente ci-dessous est donc l'unique point de départ de TOUS les
// appels réseau vers Odoo, qu'ils lisent ou écrivent — une synchronisation de
// lecture et une création de brouillon ne se marchent jamais dessus.
//
// Deux protocoles, départagés au branchement réel :
//   - JSON-2 (Odoo 19+) : POST <ODOO_URL>/json/2/<modèle>/<méthode>, clé API
//     en « Authorization: bearer », arguments nommés dans le corps.
//   - JSON-RPC (historique, déprécié par Odoo à partir de la 19) :
//     POST <ODOO_URL>/jsonrpc, common.authenticate puis object.execute_kw.
// Les deux reçoivent les mêmes arguments NOMMÉS (domain, fields, vals_list…).
//
// Aucune dépendance (fetch natif), aucun accès base : fichier autonome.

export type OdooProtocole = 'json2' | 'jsonrpc';

const TIMEOUT_MS = 20_000;
const MODELE_VALIDE = /^[a-z0-9_.]+$/;
// Un peu plus d'une seconde entre deux départs d'appel.
const INTERVALLE_MS = 1_100;
// Sur HTTP 429 : 1 appel + 2 nouvelles tentatives, attente plafonnée.
const ESSAIS_429 = 3;
const ATTENTE_429_MAX_MS = 5_000;

export function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

export function isOdooConfigured(): boolean {
  return Boolean(env('ODOO_URL') && env('ODOO_DB') && env('ODOO_USER') && env('ODOO_API_KEY'));
}

// Tolère une adresse saisie sans « https:// » ou avec un chemin collé depuis
// le navigateur : on ne garde que l'origine (https://exemple.odoo.com).
export function baseUrl(): string {
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

export function modeleValide(model: string): boolean {
  return MODELE_VALIDE.test(model);
}

// ─── File d'attente : un appel à la fois, espacés ───────────────────────────
// État propre à l'instance serveur : deux exécutions simultanées sur deux
// instances ne se voient pas — ne jamais lancer deux traitements Odoo en même
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

export async function postJson(
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

export interface JsonRpcEnvelope {
  result?: unknown;
  error?: { message?: string; data?: { message?: string } };
}

export async function jsonRpc(service: string, method: string, args: unknown[]): Promise<unknown> {
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

// ─── Appel générique (réservé aux portes lecture / écriture) ────────────────

/**
 * Envoie UN appel à Odoo avec des arguments nommés, par le protocole demandé.
 * Ne vérifie PAS la méthode : c'est le rôle de odoo-read.ts et odoo-write.ts.
 */
export async function odooAppel<T = unknown>(
  protocole: OdooProtocole,
  model: string,
  method: string,
  named: Record<string, unknown> = {},
): Promise<T> {
  if (!modeleValide(model)) throw new Error(`Modèle Odoo invalide : ${model}`);
  if (!isOdooConfigured()) throw new Error('Clés Odoo absentes côté serveur.');

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
