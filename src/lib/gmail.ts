// Gmail — lecture des emails liés à un dossier d'intervention.
//
// Usage prévu : enrichir le contexte du system prompt FoxO avant la génération
// du rapport. Le brief contient typiquement la dictée du tech sur place ; les
// emails apportent les échanges en amont (description initiale, photos jointes
// envoyées par le syndic, demandes de devis…).
//
// Branchement futur :
//   - Variable d'env : GOOGLE_OAUTH_CREDENTIALS (refresh token sur l'inbox info@foxo.be)
//     · OAuth user, pas service account, parce qu'on lit une vraie boîte humaine.
//   - Scope minimal : https://www.googleapis.com/auth/gmail.readonly
//
// Tant que les credentials ne sont pas configurés, les fonctions retournent
// `{ ok: true, emails: [] }` (= "pas d'emails trouvés") pour ne pas bloquer
// la génération de rapport. Quand GOOGLE_OAUTH_CREDENTIALS est présent, les
// fonctions se branchent automatiquement.

export interface GmailMessage {
  id: string;
  thread_id: string;
  from: string;
  to: string;
  subject: string;
  date: string;            // ISO
  snippet: string;
  body_text: string;
  attachments: { filename: string; mime_type: string; size: number }[];
}

export type GmailSearchResult =
  | { ok: true; emails: GmailMessage[] }
  | { ok: false; error: string };

export type GmailThreadResult =
  | { ok: true; messages: GmailMessage[] }
  | { ok: false; error: string };

function gmailConfigured(): boolean {
  return Boolean(process.env.GOOGLE_OAUTH_CREDENTIALS);
}

// TODO : recherche les emails liés à une intervention par adresse, ref ACP,
// nom de l'occupant ou ref FoxO. Retourne les 20 plus récents triés desc.
// Côté Gmail API : q="(subject:'2026-014' OR subject:'Avenue Louise 42')"
export async function searchEmailsByDossier(_args: {
  ref?: string;             // "2026-014"
  adresse?: string;         // "Avenue Louise 42, 1050"
  acpNom?: string;          // "Résidence Bellevue"
  occupantNom?: string;     // "Dupont"
  syndicEmail?: string;     // pour filtrer par expéditeur connu
  limit?: number;
}): Promise<GmailSearchResult> {
  if (!gmailConfigured()) {
    return { ok: true, emails: [] };
  }
  // Implémentation future : googleapis.gmail.users.messages.list + .get.
  return { ok: true, emails: [] };
}

// TODO : récupère le fil de discussion complet (utile pour reconstruire le
// contexte d'un échange Gmail).
export async function getEmailThread(_threadId: string): Promise<GmailThreadResult> {
  if (!gmailConfigured()) {
    return { ok: true, messages: [] };
  }
  // Implémentation future : googleapis.gmail.users.threads.get.
  return { ok: true, messages: [] };
}
