// Gmail — implémentation REST via fetch(). Accès complet au compte
// (scope https://mail.google.com/ : lecture, envoi, modification de labels).
// Sert à enrichir le contexte de génération de rapport et à envoyer
// les réponses-mail déclenchées depuis l'admin.

import { getValidAccessToken } from '@/lib/google-auth';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface GmailAttachmentRef {
  filename: string;
  mime_type: string;
  size: number;
  // Présent uniquement quand le message vient de getMessage(format=full)
  // — Gmail expose `body.attachmentId` qui sert à downloadGmailAttachment.
  // Absent / null pour les autres cas (listInboxMails metadata, …).
  attachment_id: string | null;
}

export interface GmailMessage {
  id: string;
  thread_id: string;
  from: string;
  to: string;
  subject: string;
  date: string;            // ISO
  snippet: string;
  body_text: string;
  attachments: GmailAttachmentRef[];
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
  body?: { data?: string; size?: number; attachmentId?: string };
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

function extractAttachments(p: RawPayload | undefined): GmailAttachmentRef[] {
  if (!p) return [];
  const out: GmailAttachmentRef[] = [];
  function walk(part: RawPayload) {
    if (part.filename && part.filename.length > 0) {
      out.push({
        filename: part.filename,
        mime_type: part.mimeType ?? 'application/octet-stream',
        size: part.body?.size ?? 0,
        attachment_id: part.body?.attachmentId ?? null,
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
  label_ids: string[];
}

export interface GmailLabel {
  id: string;
  name: string;
  type: 'system' | 'user';
  messages_unread: number;
  messages_total: number;
  color: { text_color: string; background_color: string } | null;
}

export interface MailDetail extends MailListItem {
  to: string;
  cc: string;       // raw header (peut contenir plusieurs adresses séparées par virgule)
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
  if (!auth) return { ok: false, error: 'Google non connecté.' };

  const limit = Math.max(1, Math.min(args.limit ?? 30, 100));
  const baseQ = args.q?.trim() || 'in:inbox';
  const url = `${API}/messages?q=${encodeURIComponent(baseQ)}&maxResults=${limit}`;

  const listRes = await fetch(url, { headers: { Authorization: `Bearer ${auth.access_token}` } });
  if (!listRes.ok) {
    const body = await listRes.text();
    return { ok: false, error: `Gmail HTTP ${listRes.status} : ${body.slice(0, 200)}` };
  }
  const listJson = (await listRes.json()) as { messages?: { id: string }[]; resultSizeEstimate?: number };
  const ids = (listJson.messages ?? []).map((m) => m.id);
  if (ids.length === 0) return { ok: true, mails: [] };

  // Fetch metadata en parallèle (Gmail API supporte ~10 req/s, on reste sage)
  const fetched = await Promise.all(
    ids.map(async (id) => {
      const r = await fetch(`${API}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, {
        headers: { Authorization: `Bearer ${auth.access_token}` },
      });
      if (!r.ok) return null;
      const raw = (await r.json()) as RawMessageWithLabels;
      const date = raw.internalDate ? new Date(parseInt(raw.internalDate, 10)).toISOString() : '';
      const labelIds = raw.labelIds ?? [];
      const item: MailListItem = {
        id: raw.id,
        thread_id: raw.threadId,
        from: header(raw.payload, 'From'),
        subject: header(raw.payload, 'Subject') || '(sans objet)',
        date,
        snippet: raw.snippet ?? '',
        unread: labelIds.includes('UNREAD'),
        label_ids: labelIds,
      };
      return item;
    }),
  );
  const mails = fetched.filter((m): m is MailListItem => m !== null);
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
    cc: header(raw.payload, 'Cc'),
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

// ─── Labels (page /admin/mails) ──────────────────────────────────────────

interface RawGmailLabel {
  id: string;
  name: string;
  type?: 'system' | 'user';
  messagesTotal?: number;
  messagesUnread?: number;
  color?: { textColor?: string; backgroundColor?: string };
}

// Liste tous les labels Gmail. Retourne uniquement les labels utilisateur
// (type=user) — exclut les labels système comme INBOX, UNREAD, IMPORTANT,
// SENT, DRAFT, SPAM, TRASH, CHAT, STARRED, CATEGORY_*. Les labels métier
// FoxO/* (posés par le cron) sont des labels utilisateur, donc inclus.
//
// Les compteurs messagesUnread ne sont pas renvoyés par labels.list — on
// fait un labels.get par label en parallèle pour les obtenir.
export async function listGmailLabels(): Promise<{ ok: true; labels: GmailLabel[] } | { ok: false; error: string }> {
  const auth = await getValidAccessToken();
  if (!auth) return { ok: false, error: 'Google non connecté.' };

  const listRes = await fetch(`${API}/labels`, {
    headers: { Authorization: `Bearer ${auth.access_token}` },
  });
  if (!listRes.ok) {
    const t = await listRes.text();
    return { ok: false, error: `Labels list HTTP ${listRes.status} : ${t.slice(0, 200)}` };
  }
  const j = (await listRes.json()) as { labels?: RawGmailLabel[] };
  const userLabels = (j.labels ?? []).filter((l) => l.type === 'user');

  // Fetch détails (messagesUnread, color) en parallèle. Volume usuel < 30.
  const detailed = await Promise.all(
    userLabels.map(async (l): Promise<GmailLabel | null> => {
      const r = await fetch(`${API}/labels/${l.id}`, {
        headers: { Authorization: `Bearer ${auth.access_token}` },
      });
      if (!r.ok) return null;
      const d = (await r.json()) as RawGmailLabel;
      return {
        id: d.id,
        name: d.name,
        type: d.type ?? 'user',
        messages_unread: d.messagesUnread ?? 0,
        messages_total: d.messagesTotal ?? 0,
        color: d.color?.textColor && d.color?.backgroundColor
          ? { text_color: d.color.textColor, background_color: d.color.backgroundColor }
          : null,
      };
    }),
  );
  const labels = detailed.filter((x): x is GmailLabel => x !== null)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return { ok: true, labels };
}

// Crée un label utilisateur. Échoue si le nom existe déjà (409).
export async function createGmailLabel(args: {
  name: string;
  textColor?: string;
  backgroundColor?: string;
}): Promise<{ ok: true; label: GmailLabel } | { ok: false; error: string }> {
  const auth = await getValidAccessToken();
  if (!auth) return { ok: false, error: 'Google non connecté.' };

  const body: Record<string, unknown> = {
    name: args.name,
    labelListVisibility: 'labelShow',
    messageListVisibility: 'show',
  };
  if (args.textColor && args.backgroundColor) {
    body.color = { textColor: args.textColor, backgroundColor: args.backgroundColor };
  }

  const r = await fetch(`${API}/labels`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    return { ok: false, error: `Create label HTTP ${r.status} : ${t.slice(0, 200)}` };
  }
  const d = (await r.json()) as RawGmailLabel;
  const label: GmailLabel = {
    id: d.id,
    name: d.name,
    type: d.type ?? 'user',
    messages_unread: d.messagesUnread ?? 0,
    messages_total: d.messagesTotal ?? 0,
    color: d.color?.textColor && d.color?.backgroundColor
      ? { text_color: d.color.textColor, background_color: d.color.backgroundColor }
      : null,
  };
  return { ok: true, label };
}

// Modifie les labels d'un seul mail (add/remove). Les paramètres reçoivent
// déjà des labelIds Gmail (system ou user) — résolution faite côté client
// via la liste /labels.
export async function modifyMailLabels(args: {
  mailId: string;
  addLabelIds?: string[];
  removeLabelIds?: string[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await getValidAccessToken();
  if (!auth) return { ok: false, error: 'Google non connecté.' };

  const body: Record<string, string[]> = {};
  if (args.addLabelIds && args.addLabelIds.length > 0) body.addLabelIds = args.addLabelIds;
  if (args.removeLabelIds && args.removeLabelIds.length > 0) body.removeLabelIds = args.removeLabelIds;
  if (!body.addLabelIds && !body.removeLabelIds) return { ok: true };

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

// Modifie les labels en masse via batchModify (1 seule requête HTTP).
// Gmail accepte jusqu'à 1000 ids par appel. On clamp à 500 par sécurité.
export async function batchModifyMails(args: {
  ids: string[];
  addLabelIds?: string[];
  removeLabelIds?: string[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await getValidAccessToken();
  if (!auth) return { ok: false, error: 'Google non connecté.' };
  if (!args.ids || args.ids.length === 0) return { ok: true };

  const ids = args.ids.slice(0, 500);
  const body: Record<string, string[]> = { ids };
  if (args.addLabelIds && args.addLabelIds.length > 0) body.addLabelIds = args.addLabelIds;
  if (args.removeLabelIds && args.removeLabelIds.length > 0) body.removeLabelIds = args.removeLabelIds;

  const r = await fetch(`${API}/messages/batchModify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    return { ok: false, error: `BatchModify HTTP ${r.status} : ${t.slice(0, 200)}` };
  }
  return { ok: true };
}

// ─── Réponse + suppression (page /admin/mails) ───────────────────────────

function extractEmailFromHeader(headerValue: string): string {
  const m = headerValue.match(/<([^>]+)>/);
  return (m ? m[1] : headerValue).trim();
}

function base64url(input: string): string {
  return Buffer.from(input, 'utf-8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Envoie une réponse à un mail existant, avec threading correct
// (In-Reply-To + References + threadId). Le from est implicite (le
// compte Google connecté). Body en text/plain UTF-8.
// Crée un brouillon Gmail rattaché à un thread existant (jumelle de
// sendMailReply mais sans envoi). Le destinataire peut être surchargé
// via `to` (pour cibler un occupant identifié au lieu du sender du
// thread). Si `to` non fourni, retombe sur le From du mail original.
//
// Retourne le draft.id Gmail + l'URL Gmail web pour ouvrir le brouillon
// directement dans l'interface utilisateur.
export async function createGmailDraft(args: {
  mailId: string;        // mail le plus récent du thread (sert d'origine pour les en-têtes)
  body: string;
  to?: string;           // override destinataire (sinon = From du mail origine)
  subject?: string;      // override Subject (sinon = "Re: <Subject origine>")
}): Promise<{ ok: true; draft_id: string; gmail_url: string } | { ok: false; error: string }> {
  const auth = await getValidAccessToken();
  if (!auth) return { ok: false, error: 'Google non connecté.' };

  const headRes = await fetch(
    `${API}/messages/${args.mailId}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=References`,
    { headers: { Authorization: `Bearer ${auth.access_token}` } },
  );
  if (!headRes.ok) {
    const t = await headRes.text();
    return { ok: false, error: `Headers HTTP ${headRes.status} : ${t.slice(0, 200)}` };
  }
  const raw = (await headRes.json()) as RawMessage;
  const origMessageId = header(raw.payload, 'Message-ID');
  const origFrom = header(raw.payload, 'From');
  const origSubject = header(raw.payload, 'Subject');
  const origReferences = header(raw.payload, 'References');
  const threadId = raw.threadId;

  const replyTo = (args.to ?? '').trim() || extractEmailFromHeader(origFrom);
  if (!replyTo) return { ok: false, error: 'Impossible de déterminer le destinataire.' };

  const subjectRaw = args.subject?.trim()
    || (/^re:\s*/i.test(origSubject) ? origSubject : `Re: ${origSubject}`);
  const references = origReferences ? `${origReferences} ${origMessageId}` : origMessageId;
  const bodyNormalized = args.body.replace(/\r?\n/g, '\r\n');

  const subjectEncoded = /^[\x20-\x7E]*$/.test(subjectRaw)
    ? subjectRaw
    : `=?UTF-8?B?${Buffer.from(subjectRaw, 'utf-8').toString('base64')}?=`;

  const mime = [
    `To: ${replyTo}`,
    `Subject: ${subjectEncoded}`,
    `In-Reply-To: ${origMessageId}`,
    `References: ${references}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `MIME-Version: 1.0`,
    ``,
    bodyNormalized,
  ].join('\r\n');

  const rawEncoded = base64url(mime);

  // POST /drafts au lieu de /messages/send → le mail apparaît dans
  // "Brouillons" Gmail au lieu d'être envoyé. L'admin valide ensuite
  // depuis l'interface Gmail web.
  const draftRes = await fetch(`${API}/drafts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: { raw: rawEncoded, threadId } }),
  });
  if (!draftRes.ok) {
    const t = await draftRes.text();
    return { ok: false, error: `Drafts HTTP ${draftRes.status} : ${t.slice(0, 300)}` };
  }
  const draft = (await draftRes.json()) as { id: string };
  return {
    ok: true,
    draft_id: draft.id,
    gmail_url: `https://mail.google.com/mail/u/0/#drafts/${draft.id}`,
  };
}

export async function sendMailReply(args: {
  mailId: string;
  body: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const auth = await getValidAccessToken();
  if (!auth) return { ok: false, error: 'Google non connecté.' };

  // 1. Récupère les en-têtes nécessaires du mail original
  const headRes = await fetch(
    `${API}/messages/${args.mailId}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=References`,
    { headers: { Authorization: `Bearer ${auth.access_token}` } },
  );
  if (!headRes.ok) {
    const t = await headRes.text();
    return { ok: false, error: `Headers HTTP ${headRes.status} : ${t.slice(0, 200)}` };
  }
  const raw = (await headRes.json()) as RawMessage;
  const origMessageId = header(raw.payload, 'Message-ID');
  const origFrom = header(raw.payload, 'From');
  const origSubject = header(raw.payload, 'Subject');
  const origReferences = header(raw.payload, 'References');
  const threadId = raw.threadId;

  const replyTo = extractEmailFromHeader(origFrom);
  if (!replyTo) return { ok: false, error: 'Impossible de déterminer le destinataire.' };

  const subject = /^re:\s*/i.test(origSubject) ? origSubject : `Re: ${origSubject}`;
  const references = origReferences ? `${origReferences} ${origMessageId}` : origMessageId;
  const bodyNormalized = args.body.replace(/\r?\n/g, '\r\n');

  // RFC 2822 — le destinataire et l'expéditeur peuvent contenir des
  // accents → encode-MIME (=?UTF-8?B?...?=) si besoin. Ici on garde
  // simple : les en-têtes restent ASCII (Subject géré par MIME).
  const subjectEncoded = /^[\x20-\x7E]*$/.test(subject)
    ? subject
    : `=?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`;

  const mime = [
    `To: ${replyTo}`,
    `Subject: ${subjectEncoded}`,
    `In-Reply-To: ${origMessageId}`,
    `References: ${references}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `MIME-Version: 1.0`,
    ``,
    bodyNormalized,
  ].join('\r\n');

  const rawEncoded = base64url(mime);

  // 2. Envoi via /messages/send (threadId pour conserver le fil)
  const sendRes = await fetch(`${API}/messages/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: rawEncoded, threadId }),
  });
  if (!sendRes.ok) {
    const t = await sendRes.text();
    return { ok: false, error: `Send HTTP ${sendRes.status} : ${t.slice(0, 300)}` };
  }
  const sent = (await sendRes.json()) as { id: string };
  return { ok: true, id: sent.id };
}

export interface GmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;          // défaut application/octet-stream
}

// Envoie un email arbitraire via le compte Gmail connecté.
// Le `from` doit être une adresse autorisée (l'adresse principale OU
// un alias "Send mail as" configuré dans Gmail Settings → Comptes).
// Pour envoyer en HTML, passe le contenu dans `html`. `text` est
// optionnel (fallback plain text). Utilisé notamment pour les OTP
// Supabase (Send Email Hook → /api/auth/send-email).
//
// `attachments` : pièces jointes binaires (PDF facture, etc.).
// Quand présent, la structure MIME devient multipart/mixed wrappant
// un multipart/alternative (text + html) suivi d'un part par fichier
// en base64. Les attachements sont volontairement encodés en base64
// avec wrapping à 76 colonnes (RFC 2045).
export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  attachments?: GmailAttachment[];
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const auth = await getValidAccessToken();
  if (!auth) return { ok: false, error: 'Google non connecté.' };

  const from = args.from ?? 'FoxO <info@foxo.be>';

  // Encode RFC 2047 pour les en-têtes contenant des accents (Subject, From).
  const encodeHeader = (v: string): string =>
    /^[\x20-\x7E]*$/.test(v)
      ? v
      : `=?UTF-8?B?${Buffer.from(v, 'utf-8').toString('base64')}?=`;

  function altPart(boundary: string): string {
    if (args.text) {
      return [
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        ``,
        `--${boundary}`,
        `Content-Type: text/plain; charset="UTF-8"`,
        `Content-Transfer-Encoding: 8bit`,
        ``,
        args.text,
        ``,
        `--${boundary}`,
        `Content-Type: text/html; charset="UTF-8"`,
        `Content-Transfer-Encoding: 8bit`,
        ``,
        args.html,
        ``,
        `--${boundary}--`,
      ].join('\r\n');
    }
    return [
      `Content-Type: text/html; charset="UTF-8"`,
      `Content-Transfer-Encoding: 8bit`,
      ``,
      args.html,
    ].join('\r\n');
  }

  // Wrap base64 à 76 chars/ligne (RFC 2045). Les clients mail strictes
  // (Outlook desktop) refusent les lignes plus longues sans pliage.
  function chunkBase64(b64: string): string {
    return b64.match(/.{1,76}/g)?.join('\r\n') ?? b64;
  }

  function attachmentPart(att: GmailAttachment): string {
    const ctype = att.contentType ?? 'application/octet-stream';
    const fnameEncoded = encodeHeader(att.filename);
    return [
      `Content-Type: ${ctype}; name="${fnameEncoded}"`,
      `Content-Disposition: attachment; filename="${fnameEncoded}"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      chunkBase64(att.content.toString('base64')),
    ].join('\r\n');
  }

  const headers = [
    `From: ${encodeHeader(from)}`,
    `To: ${args.to}`,
    `Subject: ${encodeHeader(args.subject)}`,
    `MIME-Version: 1.0`,
  ];

  let mime: string;
  const hasAttachments = args.attachments && args.attachments.length > 0;
  if (hasAttachments) {
    const outerBoundary = `=_FoxO_outer_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const innerBoundary = `=_FoxO_inner_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const parts: string[] = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${outerBoundary}"`,
      ``,
      `--${outerBoundary}`,
      altPart(innerBoundary),
    ];
    for (const a of args.attachments!) {
      parts.push(`--${outerBoundary}`, attachmentPart(a));
    }
    parts.push(`--${outerBoundary}--`, ``);
    mime = parts.join('\r\n');
  } else if (args.text) {
    const boundary = `=_FoxO_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    mime = [...headers, altPart(boundary), ``].join('\r\n');
  } else {
    mime = [
      ...headers,
      `Content-Type: text/html; charset="UTF-8"`,
      `Content-Transfer-Encoding: 8bit`,
      ``,
      args.html,
    ].join('\r\n');
  }

  const raw = Buffer.from(mime, 'utf-8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const r = await fetch(`${API}/messages/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });
  if (!r.ok) {
    const t = await r.text();
    return { ok: false, error: `Send HTTP ${r.status} : ${t.slice(0, 300)}` };
  }
  const sent = (await r.json()) as { id: string };
  return { ok: true, id: sent.id };
}

// Supprime DÉFINITIVEMENT un mail (pas de récupération possible).
// Requiert le scope mail.google.com — gmail.modify ne suffit pas.
export async function deleteMailPermanently(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await getValidAccessToken();
  if (!auth) return { ok: false, error: 'Google non connecté.' };
  const r = await fetch(`${API}/messages/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${auth.access_token}` },
  });
  if (!r.ok) {
    const t = await r.text();
    return { ok: false, error: `Delete HTTP ${r.status} : ${t.slice(0, 200)}` };
  }
  return { ok: true };
}

// Supprime définitivement plusieurs mails en une requête (jusqu'à 1000).
export async function batchDeletePermanently(ids: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await getValidAccessToken();
  if (!auth) return { ok: false, error: 'Google non connecté.' };
  if (ids.length === 0) return { ok: true };
  const r = await fetch(`${API}/messages/batchDelete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: ids.slice(0, 1000) }),
  });
  if (!r.ok) {
    const t = await r.text();
    return { ok: false, error: `BatchDelete HTTP ${r.status} : ${t.slice(0, 200)}` };
  }
  return { ok: true };
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

// Télécharge le contenu d'une pièce jointe Gmail. Retourne le base64
// URL-safe brut (à passer tel quel à uploadAttachmentToFolder qui gère
// le décodage). Retourne null si l'API échoue (best-effort, ne throw pas).
export async function downloadGmailAttachment(
  messageId: string,
  attachmentId: string,
): Promise<string | null> {
  const auth = await getValidAccessToken();
  if (!auth) return null;
  const res = await fetch(
    `${API}/messages/${messageId}/attachments/${attachmentId}`,
    { headers: { Authorization: `Bearer ${auth.access_token}` } },
  );
  if (!res.ok) return null;
  const j = (await res.json()) as { data?: string };
  return j.data ?? null;
}
