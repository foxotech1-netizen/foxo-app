// PLACEHOLDER non branché — sera implémenté avec le module Facturation.
// Ne pas supprimer.
//
// Ponto (MyPonto) — synchronisation bancaire automatique.
//
// Branchement futur : MyPonto agrégateur AISP (Isabel Group) pour récupérer
// les transactions Beobank en continu et matcher automatiquement les
// paiements de factures via la communication structurée (BBA).
//
// Variables d'env (à venir) :
//   - PONTO_CLIENT_ID
//   - PONTO_CLIENT_SECRET
//   - PONTO_API_KEY (peut être stockée dans la table parametres avec clé
//     ponto_api_key pour permettre rotation depuis /admin/parametres)
//
// Tant que ce n'est pas configuré, les fonctions retournent
// `{ ok: false, error: 'Ponto non configuré' }`.

export type PontoSyncResult =
  | { ok: true; matched: number; unmatched: number }
  | { ok: false; error: string };

export interface PontoTransaction {
  id: string;
  date: string;            // ISO
  amount: number;          // > 0 = entrée
  currency: string;
  description: string;
  structured_reference?: string;
  counterparty_name?: string;
  counterparty_iban?: string;
}

function pontoConfigured(): boolean {
  return Boolean(process.env.PONTO_CLIENT_ID && process.env.PONTO_CLIENT_SECRET);
}

// TODO : OAuth2 client_credentials → token. Stocker en cache mémoire (TTL).
export async function connectPonto(): Promise<{ ok: boolean; error?: string }> {
  if (!pontoConfigured()) return { ok: false, error: 'Ponto non configuré (PONTO_CLIENT_ID manquant).' };
  // Implémentation future : POST https://api.myponto.com/oauth2/token
  return { ok: false, error: 'Non implémenté.' };
}

// TODO : récupère les transactions sur la fenêtre [from, to] et les matche
// avec public.factures.reference_structuree. Quand match → update statut
// = 'payee' + date_paiement = transaction.date.
export async function syncTransactions(_from: Date, _to: Date): Promise<PontoSyncResult> {
  if (!pontoConfigured()) {
    return { ok: false, error: 'Ponto non configuré.' };
  }
  // Implémentation future : GET /accounts/{id}/transactions, parser, matcher,
  // upsert sur factures.
  return { ok: true, matched: 0, unmatched: 0 };
}
