// Lecture Odoo — porte en LECTURE SEULE (chantier « Odoo visible dans FoxO »).
//
// Sens inverse du connecteur d'écriture (odoo-write.ts) : ici FoxO LIT Odoo
// et n'y écrit jamais. Garanti par construction : seules les méthodes listées
// dans METHODES_LECTURE peuvent partir sur le réseau (default_get ne fait que
// calculer des valeurs par défaut en mémoire : rien n'est écrit).
//
// Indépendant des interrupteurs d'écriture (parametres.odoo_sync_enabled,
// parametres.odoo_ecriture_active) : on doit pouvoir lire pendant qu'ils
// restent éteints.
//
// La plomberie (protocoles JSON-2 / JSON-RPC, file d'attente à un appel par
// seconde, nouvelle tentative sur 429) est dans odoo-transport.ts, partagée
// avec l'écriture pour que lecture et écriture ne s'entrechoquent jamais.
// Conséquence pour l'appelant : préférer peu d'appels qui ramènent beaucoup
// de lignes à beaucoup de petits appels.
//
// Aucune dépendance (fetch natif), aucun accès base : fichier autonome.

import {
  baseUrl,
  isOdooConfigured,
  jsonRpc,
  odooAppel,
  postJson,
  type JsonRpcEnvelope,
  type OdooProtocole,
} from './odoo-transport';

export { odooHost, odooNombreAppels, type OdooProtocole } from './odoo-transport';

const METHODES_LECTURE = ['search_read', 'search_count', 'fields_get', 'default_get'] as const;
export type OdooMethodeLecture = (typeof METHODES_LECTURE)[number];

export function isOdooReadConfigured(): boolean {
  return isOdooConfigured();
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
  return odooAppel<T>(protocole, model, method, named);
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
