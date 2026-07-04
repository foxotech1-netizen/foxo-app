// Module Storecove (point d'accès Peppol) — DÉBRANCHÉ PAR DÉFAUT.
//
// Double interrupteur :
//   1. Configuration serveur : env STORECOVE_API_KEY + STORECOVE_LEGAL_ENTITY_ID
//      (variables Vercel — les clés ne vivent JAMAIS en base ni côté client).
//   2. Interrupteur métier : parametres.storecove_enabled === 'true'
//      (activable depuis /admin/parametres sans redéploiement).
// Tant que les deux ne sont pas réunis, AUCUN appel réseau n'est effectué.
//
// Pattern best-effort maison : sendViaPeppol ne throw jamais — elle renvoie
// { ok, error? } et consigne l'issue sur la facture (peppol_status,
// peppol_document_id, peppol_sent_at ; message d'erreur en note interne).
//
// ── Hypothèses sur le payload Storecove (API v2, à vérifier au branchement
// réel — https://www.storecove.com/docs/) :
//   POST https://api.storecove.com/api/v2/document_submissions
//   Authorization: Bearer <STORECOVE_API_KEY>
//   {
//     "legalEntityId": <number>,            // id d'entité légale Storecove (env)
//     "routing": {
//       "eIdentifiers": [{ "scheme": "BE:CBE", "id": "<BCE chiffres>" }]
//     },                                    // BE:CBE = ICD 0208 (n° BCE)
//     "document": {
//       "documentType": "invoice",          // couvre invoice ET credit note UBL
//       "rawDocumentData": {
//         "document": "<UBL en base64>",
//         "parse": true,
//         "parseStrategy": "ubl"
//       }
//     }
//   }
//   Réponse succès (2xx) : { "guid": "..." } → peppol_document_id.

import { createAdminClient } from '@/lib/supabase/admin';
import { buildUblXml, supplierParamsFromMap, normalizeBce } from './ubl';
import type { Facture, Parametre } from '@/lib/types/database';

const STORECOVE_SUBMISSIONS_URL = 'https://api.storecove.com/api/v2/document_submissions';

export type PeppolSendResult =
  | { ok: true; documentId: string }
  | { ok: false; error: string };

export function isStorecoveConfigured(): boolean {
  return Boolean(
    process.env.STORECOVE_API_KEY?.trim()
    && process.env.STORECOVE_LEGAL_ENTITY_ID?.trim(),
  );
}

export async function isStorecoveEnabled(): Promise<boolean> {
  if (!isStorecoveConfigured()) return false;
  const admin = createAdminClient();
  const { data } = await admin
    .from('parametres')
    .select('valeur')
    .eq('cle', 'storecove_enabled')
    .maybeSingle();
  return data?.valeur === 'true';
}

export async function sendViaPeppol(factureId: string): Promise<PeppolSendResult> {
  // ── Garde-fous — AUCUN appel réseau tant que tout n'est pas réuni ──────
  if (!(await isStorecoveEnabled())) {
    return { ok: false, error: 'Peppol non activé — configurez Storecove dans Paramètres.' };
  }

  const admin = createAdminClient();
  const { data: row } = await admin
    .from('factures')
    .select('*')
    .eq('id', factureId)
    .maybeSingle();
  if (!row) return { ok: false, error: 'Document introuvable.' };
  const facture = row as Facture;

  if (facture.type !== 'facture' && facture.type !== 'avoir') {
    return { ok: false, error: 'Seules les factures et notes de crédit sont transmissibles via Peppol.' };
  }
  if (facture.statut === 'brouillon' || (facture.numero ?? '').startsWith('BR-')) {
    return { ok: false, error: 'Émets d\'abord le document — un brouillon ne peut pas partir sur Peppol.' };
  }
  if (facture.statut === 'annulee') {
    return { ok: false, error: 'Document annulé — envoi Peppol refusé.' };
  }
  const clientBce = normalizeBce(facture.client_bce);
  if (!clientBce) {
    return { ok: false, error: 'N° BCE du client manquant — impossible de router le document sur Peppol.' };
  }

  // ── Construction UBL (params société depuis `parametres`) ─────────────
  let xml: string;
  try {
    const { data: paramsRows } = await admin.from('parametres').select('cle, valeur');
    const map: Record<string, string> = {};
    for (const p of (paramsRows ?? []) as Pick<Parametre, 'cle' | 'valeur'>[]) {
      map[p.cle] = p.valeur ?? '';
    }
    xml = buildUblXml(facture, supplierParamsFromMap(map));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur génération UBL.' };
  }

  // ── Envoi Storecove (best-effort : l'échec est consigné, jamais throw) ─
  const markError = async (message: string): Promise<PeppolSendResult> => {
    const note = `[Peppol ${new Date().toISOString().slice(0, 10)}] Échec : ${message}`.slice(0, 500);
    await admin
      .from('factures')
      .update({
        peppol_status: 'erreur',
        notes: facture.notes ? `${facture.notes}\n${note}` : note,
        updated_at: new Date().toISOString(),
      })
      .eq('id', facture.id);
    return { ok: false, error: message };
  };

  try {
    const res = await fetch(STORECOVE_SUBMISSIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.STORECOVE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        legalEntityId: Number(process.env.STORECOVE_LEGAL_ENTITY_ID),
        routing: {
          eIdentifiers: [{ scheme: 'BE:CBE', id: clientBce }],
        },
        document: {
          documentType: 'invoice',
          rawDocumentData: {
            document: Buffer.from(xml, 'utf-8').toString('base64'),
            parse: true,
            parseStrategy: 'ubl',
          },
        },
      }),
    });

    if (!res.ok) {
      const bodyText = (await res.text().catch(() => '')).slice(0, 300);
      return await markError(`Storecove HTTP ${res.status}${bodyText ? ` — ${bodyText}` : ''}`);
    }

    const json = (await res.json().catch(() => ({}))) as { guid?: string };
    const documentId = json.guid ?? '';

    await admin
      .from('factures')
      .update({
        peppol_status: 'envoyee',
        peppol_document_id: documentId || null,
        peppol_sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', facture.id);

    return { ok: true, documentId };
  } catch (e) {
    return await markError(e instanceof Error ? e.message : 'Erreur réseau Storecove.');
  }
}
