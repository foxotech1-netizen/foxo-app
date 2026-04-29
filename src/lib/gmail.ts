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
