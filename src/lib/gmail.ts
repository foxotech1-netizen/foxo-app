// Gmail — implémentation REST via fetch(). Lecture seule (scope
// gmail.readonly). Sert principalement à enrichir le contexte de
// génération de rapport par l'assistant Claude.

import { getValidAccessToken } from '@/lib/google-auth';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

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

interface RawHeader { name: string; value: string }
interface RawPayload {
  mimeType?: string;
  headers?: RawHeader[];
  body?: { data?: string; size?: number };
  parts?: RawPayload[];
  filename?: string;
}
interface RawMessage {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  payload?: RawPayload;
}

function header(p: RawPayload | undefined, name: string): string {
  if (!p?.headers) return '';
  const lower = name.toLowerCase();
  return p.headers.find((h) => h.name.toLowerCase() === lower)?.value ?? '';
}

function decodeB64Url(data: string): string {
  try {
    const b = data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(b, 'base64').toString('utf-8');
  } catch { return ''; }
}

function extractText(p: RawPayload | undefined): string {
  if (!p) return '';
  if (p.mimeType === 'text/plain' && p.body?.data) {
    return decodeB64Url(p.body.data);
  }
  if (p.parts && p.parts.length > 0) {
    // Prefer text/plain ; sinon premier text/*
    const plain = p.parts.find((x) => x.mimeType === 'text/plain' && x.body?.data);
    if (plain?.body?.data) return decodeB64Url(plain.body.data);
    for (const part of p.parts) {
      const t = extractText(part);
      if (t) return t;
    }
  }
  return '';
}

function extractHtml(p: RawPayload | undefined): string {
  if (!p) return '';
  if (p.mimeType === 'text/html' && p.body?.data) {
    return decodeB64Url(p.body.data);
  }
  if (p.parts && p.parts.length > 0) {
    const html = p.parts.find((x) => x.mimeType === 'text/html' && x.body?.data);
    if (html?.body?.data) return decodeB64Url(html.body.data);
    for (const part of p.parts) {
      const h = extractHtml(part);
      if (h) return h;
    }
  }
  return '';
}

function extractAttachments(p: RawPayload | undefined): { filename: string; mime_type: string; size: number }[] {
  if (!p) return [];
  const out: { filename: string; mime_type: string; size: number }[] = [];
  function walk(part: RawPayload) {
    if (part.filename && part.filename.length > 0) {
      out.push({
        filename: part.filename,
        mime_type: part.mimeType ?? 'application/octet-stream',
        size: part.body?.size ?? 0,
      });
    }
    part.parts?.forEach(walk);
  }
  walk(p);
  return out;
}

function toMessage(raw: RawMessage): GmailMessage {
  const date = raw.internalDate ? new Date(parseInt(raw.internalDate, 10)).toISOString() : '';
  return {
    id: raw.id,
    thread_id: raw.threadId,
    from: header(raw.payload, 'From'),
    to: header(raw.payload, 'To'),
    subject: header(raw.payload, 'Subject'),
    date,
    snippet: raw.snippet ?? '',
    body_text: extractText(raw.payload).slice(0, 4000),
    attachments: extractAttachments(raw.payload),
  };
}

async function listMessageIds(token: string, q: string, max: number): Promise<string[]> {
  const url = `${API}/messages?q=${encodeURIComponent(q)}&maxResults=${max}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const j = (await res.json()) as { messages?: { id: string }[] };
  return (j.messages ?? []).map((m) => m.id);
}

async function getMessage(token: string, id: string): Promise<RawMessage | null> {
  const res = await fetch(`${API}/messages/${id}?format=full`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as RawMessage;
}

export async function searchEmailsByDossier(args: {
  ref?: string;
  adresse?: string;
  acpNom?: string;
  occupantNom?: string;
  syndicEmail?: string;
  limit?: number;
}): Promise<GmailSearchResult> {
  const auth = await getValidAccessToken();
  if (!auth) return { ok: true, emails: [] };

  const limit = Math.max(1, Math.min(args.limit ?? 20, 50));
  // Construit une query OR sur les champs disponibles
  const parts: string[] = [];
  if (args.ref) parts.push(`"${args.ref}"`);
  if (args.adresse) parts.push(`"${args.adresse}"`);
  if (args.acpNom) parts.push(`"${args.acpNom}"`);
  if (args.occupantNom) parts.push(`"${args.occupantNom}"`);
  if (args.syndicEmail) parts.push(`from:${args.syndicEmail}`);
  if (parts.length === 0) return { ok: true, emails: [] };
  const q = parts.join(' OR ');

  const ids = await listMessageIds(auth.access_token, q, limit);
  if (ids.length === 0) return { ok: true, emails: [] };

  const messages: GmailMessage[] = [];
  // En série pour éviter rate-limit ; on peut paralléliser plus tard
  for (const id of ids) {
    const raw = await getMessage(auth.access_token, id);
    if (raw) messages.push(toMessage(raw));
  }
  return { ok: true, emails: messages };
}

// Alias pour compatibilité avec les appelants existants
export async function searchEmailsByIntervention(ref: string, adresse: string): Promise<GmailSearchResult> {
  return searchEmailsByDossier({ ref, adresse });
}

// ─── Mails inbox (page /admin/mails) ─────────────────────────────────────

export interface MailListItem {
  id: string;
  thread_id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  unread: boolean;
}

export interface MailDetail extends MailListItem {
  to: string;
  body_text: string;
  body_html: string;
  attachments: { filename: string; mime_type: string; size: number }[];
  label_ids: string[];
}

interface RawMessageWithLabels extends RawMessage {
  labelIds?: string[];
}

// Liste les `limit` derniers mails de la boîte (in:inbox), avec metadata
// suffisante pour l'affichage liste. Inclut le statut "non lu" via labelIds.
export async function listInboxMails(args: { limit?: number; q?: string }): Promise<{
  ok: true; mails: MailListItem[];
} | { ok: false; error: string }> {
  const auth = await getValidAccessToken();
  if (!auth) {
    console.error('[mails-debug] listInboxMails: getValidAccessToken returned null (pas de token valide)');
    return { ok: false, error: 'Google non connecté.' };
  }
  console.error('[mails-debug] listInboxMails: token OK pour', auth.email);

  const limit = Math.max(1, Math.min(args.limit ?? 30, 100));
  const baseQ = args.q?.trim() || 'in:inbox';
  const url = `${API}/messages?q=${encodeURIComponent(baseQ)}&maxResults=${limit}`;
  console.error('[mails-debug] Gmail GET', url);

  const listRes = await fetch(url, { headers: { Authorization: `Bearer ${auth.access_token}` } });
  if (!listRes.ok) {
    const body = await listRes.text();
    console.error('[mails-debug] Gmail HTTP', listRes.status, 'body:', body.slice(0, 500));
    return { ok: false, error: `Gmail HTTP ${listRes.status} : ${body.slice(0, 200)}` };
  }
  const listJson = (await listRes.json()) as { messages?: { id: string }[]; resultSizeEstimate?: number };
  console.error('[mails-debug] Gmail list response:', { messages_count: listJson.messages?.length ?? 0, resultSizeEstimate: listJson.resultSizeEstimate });
  const ids = (listJson.messages ?? []).map((m) => m.id);
  if (ids.length === 0) {
    console.error('[mails-debug] Aucun message — résultat vide pour q="' + baseQ + '"');
    return { ok: true, mails: [] };
  }

  // Fetch metadata en parallèle (Gmail API supporte ~10 req/s, on reste sage)
  const fetched = await Promise.all(
    ids.map(async (id) => {
      const r = await fetch(`${API}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, {
        headers: { Authorization: `Bearer ${auth.access_token}` },
      });
      if (!r.ok) {
        const txt = await r.text();
        console.error('[mails-debug] metadata fetch failed for', id, 'HTTP', r.status, txt.slice(0, 200));
        return null;
      }
      const raw = (await r.json()) as RawMessageWithLabels;
      const date = raw.internalDate ? new Date(parseInt(raw.internalDate, 10)).toISOString() : '';
      const item: MailListItem = {
        id: raw.id,
        thread_id: raw.threadId,
        from: header(raw.payload, 'From'),
        subject: header(raw.payload, 'Subject') || '(sans objet)',
        date,
        snippet: raw.snippet ?? '',
        unread: (raw.labelIds ?? []).includes('UNREAD'),
      };
      return item;
    }),
  );
  const mails = fetched.filter((m): m is MailListItem => m !== null);
  console.error('[mails-debug] listInboxMails: built', mails.length, '/', ids.length, 'mails');
  return { ok: true, mails };
}

export async function countUnreadMails(): Promise<number> {
  const auth = await getValidAccessToken();
  if (!auth) return 0;
  const url = `${API}/messages?q=${encodeURIComponent('in:inbox is:unread')}&maxResults=1`;
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${auth.access_token}` } });
    if (!r.ok) return 0;
    const j = (await r.json()) as { resultSizeEstimate?: number };
    return j.resultSizeEstimate ?? 0;
  } catch {
    return 0;
  }
}

export async function getMailDetail(id: string): Promise<{ ok: true; mail: MailDetail } | { ok: false; error: string }> {
  const auth = await getValidAccessToken();
  if (!auth) return { ok: false, error: 'Google non connecté.' };
  const r = await fetch(`${API}/messages/${id}?format=full`, {
    headers: { Authorization: `Bearer ${auth.access_token}` },
  });
  if (!r.ok) {
    const t = await r.text();
    return { ok: false, error: `Gmail HTTP ${r.status} : ${t.slice(0, 200)}` };
  }
  const raw = (await r.json()) as RawMessageWithLabels;
  const date = raw.internalDate ? new Date(parseInt(raw.internalDate, 10)).toISOString() : '';
  const labelIds = raw.labelIds ?? [];
  const detail: MailDetail = {
    id: raw.id,
    thread_id: raw.threadId,
    from: header(raw.payload, 'From'),
    to: header(raw.payload, 'To'),
    subject: header(raw.payload, 'Subject') || '(sans objet)',
    date,
    snippet: raw.snippet ?? '',
    body_text: extractText(raw.payload),
    body_html: extractHtml(raw.payload),
    attachments: extractAttachments(raw.payload),
    unread: labelIds.includes('UNREAD'),
    label_ids: labelIds,
  };
  return { ok: true, mail: detail };
}

// Récupère ou crée un label custom (idempotent). Renvoie son id.
export async function ensureLabel(labelName: string): Promise<{ ok: true; label_id: string } | { ok: false; error: string }> {
  const auth = await getValidAccessToken();
  if (!auth) return { ok: false, error: 'Google non connecté.' };

  const labelsRes = await fetch(`${API}/labels`, {
    headers: { Authorization: `Bearer ${auth.access_token}` },
  });
  if (!labelsRes.ok) return { ok: false, error: `Labels list HTTP ${labelsRes.status}` };
  const labelsJson = (await labelsRes.json()) as { labels?: { id: string; name: string }[] };
  const existing = labelsJson.labels?.find((l) => l.name === labelName)?.id;
  if (existing) return { ok: true, label_id: existing };

  const createRes = await fetch(`${API}/labels`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: labelName,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    }),
  });
  if (!createRes.ok) return { ok: false, error: `Label create HTTP ${createRes.status}` };
  const j = (await createRes.json()) as { id: string };
  return { ok: true, label_id: j.id };
}

// Ajoute un label à un mail (et optionnellement retire UNREAD).
export async function addLabelToMail(args: {
  mailId: string;
  labelName: string;
  removeUnread?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await getValidAccessToken();
  if (!auth) return { ok: false, error: 'Google non connecté.' };
  const ensured = await ensureLabel(args.labelName);
  if (!ensured.ok) return { ok: false, error: ensured.error };

  const body: Record<string, string[]> = { addLabelIds: [ensured.label_id] };
  if (args.removeUnread) body.removeLabelIds = ['UNREAD'];

  const r = await fetch(`${API}/messages/${args.mailId}/modify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    return { ok: false, error: `Modify HTTP ${r.status} : ${t.slice(0, 200)}` };
  }
  return { ok: true };
}

// Retourne true si le mail porte déjà le label `labelName` (lookup via
// labelIds dans les metadata du message).
export async function mailHasLabel(mailId: string, labelName: string): Promise<boolean> {
  const auth = await getValidAccessToken();
  if (!auth) return false;
  const ensured = await ensureLabel(labelName);
  if (!ensured.ok) return false;
  const r = await fetch(`${API}/messages/${mailId}?format=metadata&fields=labelIds`, {
    headers: { Authorization: `Bearer ${auth.access_token}` },
  });
  if (!r.ok) return false;
  const j = (await r.json()) as { labelIds?: string[] };
  return (j.labelIds ?? []).includes(ensured.label_id);
}

// Crée le label FOXO_TRAITE s'il n'existe pas, puis l'ajoute au mail
// (et retire UNREAD pour décrocher la pastille). Idempotent.
export async function markMailTraite(id: string): Promise<{ ok: true; label_id: string } | { ok: false; error: string }> {
  const auth = await getValidAccessToken();
  if (!auth) return { ok: false, error: 'Google non connecté.' };

  // 1. Liste les labels existants
  const labelsRes = await fetch(`${API}/labels`, {
    headers: { Authorization: `Bearer ${auth.access_token}` },
  });
  if (!labelsRes.ok) return { ok: false, error: `Labels list HTTP ${labelsRes.status}` };
  const labelsJson = (await labelsRes.json()) as { labels?: { id: string; name: string }[] };
  let labelId = labelsJson.labels?.find((l) => l.name === 'FOXO_TRAITE')?.id;

  // 2. Crée FOXO_TRAITE si absent
  if (!labelId) {
    const createRes = await fetch(`${API}/labels`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'FOXO_TRAITE',
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      }),
    });
    if (!createRes.ok) return { ok: false, error: `Label create HTTP ${createRes.status}` };
    const j = (await createRes.json()) as { id: string };
    labelId = j.id;
  }

  // 3. Modify le mail : add FOXO_TRAITE, remove UNREAD
  const modRes = await fetch(`${API}/messages/${id}/modify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ addLabelIds: [labelId], removeLabelIds: ['UNREAD'] }),
  });
  if (!modRes.ok) {
    const t = await modRes.text();
    return { ok: false, error: `Modify HTTP ${modRes.status} : ${t.slice(0, 200)}` };
  }
  return { ok: true, label_id: labelId };
}

export async function getEmailThread(threadId: string): Promise<GmailThreadResult> {
  const auth = await getValidAccessToken();
  if (!auth) return { ok: true, messages: [] };
  const res = await fetch(`${API}/threads/${threadId}?format=full`, {
    headers: { Authorization: `Bearer ${auth.access_token}` },
  });
  if (!res.ok) {
    const t = await res.text();
    return { ok: false, error: `Gmail HTTP ${res.status} : ${t.slice(0, 200)}` };
  }
  const j = (await res.json()) as { messages?: RawMessage[] };
  return { ok: true, messages: (j.messages ?? []).map(toMessage) };
}
