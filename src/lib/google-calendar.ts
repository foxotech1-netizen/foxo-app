// Google Calendar — implémentation REST via fetch(). Compte unique connecté
// via OAuth (table google_tokens). Calendar par défaut = 'primary'.

import { getValidAccessToken } from '@/lib/google-auth';

const API = 'https://www.googleapis.com/calendar/v3';

export type CalendarSyncResult =
  | { ok: true; created: number; updated: number; blocked: number }
  | { ok: false; error: string };

export type CalendarEventResult =
  | { ok: true; event_id: string; html_link?: string }
  | { ok: false; error: string };

interface GcalEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  htmlLink?: string;
}

// Mappe un hex #RRGGBB vers le colorId Google Calendar (1-11) le plus
// proche par distance euclidienne en RGB. Les 11 couleurs Google :
//   1 Lavender, 2 Sage, 3 Grape, 4 Flamingo, 5 Banana,
//   6 Tangerine, 7 Peacock, 8 Graphite, 9 Blueberry, 10 Basil, 11 Tomato
// Source : developers.google.com/calendar/api/v3/reference/colors
const GCAL_PALETTE: { id: string; rgb: [number, number, number] }[] = [
  { id: '1',  rgb: [0xa4, 0xbd, 0xfc] }, // Lavender
  { id: '2',  rgb: [0x7a, 0xe7, 0xbf] }, // Sage
  { id: '3',  rgb: [0xdb, 0xad, 0xff] }, // Grape
  { id: '4',  rgb: [0xff, 0x88, 0x7c] }, // Flamingo
  { id: '5',  rgb: [0xfb, 0xd7, 0x5b] }, // Banana
  { id: '6',  rgb: [0xff, 0xb8, 0x78] }, // Tangerine
  { id: '7',  rgb: [0x46, 0xd6, 0xdb] }, // Peacock
  { id: '8',  rgb: [0xe1, 0xe1, 0xe1] }, // Graphite
  { id: '9',  rgb: [0x53, 0x84, 0xed] }, // Blueberry
  { id: '10', rgb: [0x51, 0xb7, 0x49] }, // Basil
  { id: '11', rgb: [0xdc, 0x20, 0x27] }, // Tomato
];

export function hexToGcalColorId(hex: string | null | undefined): string | null {
  if (!hex) return null;
  const m = hex.match(/^#([0-9A-Fa-f]{6})$/);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  let bestId: string | null = null;
  let bestDist = Infinity;
  for (const c of GCAL_PALETTE) {
    const d = (c.rgb[0] - r) ** 2 + (c.rgb[1] - g) ** 2 + (c.rgb[2] - b) ** 2;
    if (d < bestDist) { bestDist = d; bestId = c.id; }
  }
  return bestId;
}

export async function createCalendarEvent(args: {
  startIso: string;
  endIso: string;
  summary: string;
  description?: string;
  location?: string;
  technicienEmail?: string;
  colorId?: string;            // Google Calendar colorId 1-11
}): Promise<CalendarEventResult> {
  const auth = await getValidAccessToken();
  if (!auth) return { ok: false, error: 'Google non connecté.' };

  const body: Record<string, unknown> = {
    summary: args.summary,
    description: args.description ?? '',
    location: args.location ?? '',
    start: { dateTime: args.startIso, timeZone: 'Europe/Brussels' },
    end:   { dateTime: args.endIso,   timeZone: 'Europe/Brussels' },
  };
  if (args.colorId) body.colorId = args.colorId;
  if (args.technicienEmail) {
    body.attendees = [{ email: args.technicienEmail }];
  }

  const res = await fetch(`${API}/calendars/primary/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    return { ok: false, error: `Calendar HTTP ${res.status} : ${t.slice(0, 200)}` };
  }
  const data = (await res.json()) as GcalEvent;
  return { ok: true, event_id: data.id, html_link: data.htmlLink };
}

export async function updateCalendarEvent(eventId: string, changes: {
  startIso?: string;
  endIso?: string;
  summary?: string;
  description?: string;
  location?: string;
}): Promise<CalendarEventResult> {
  const auth = await getValidAccessToken();
  if (!auth) return { ok: false, error: 'Google non connecté.' };

  const patch: Record<string, unknown> = {};
  if (changes.summary !== undefined) patch.summary = changes.summary;
  if (changes.description !== undefined) patch.description = changes.description;
  if (changes.location !== undefined) patch.location = changes.location;
  if (changes.startIso) patch.start = { dateTime: changes.startIso, timeZone: 'Europe/Brussels' };
  if (changes.endIso)   patch.end   = { dateTime: changes.endIso,   timeZone: 'Europe/Brussels' };

  const res = await fetch(`${API}/calendars/primary/events/${eventId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const t = await res.text();
    return { ok: false, error: `Calendar HTTP ${res.status} : ${t.slice(0, 200)}` };
  }
  const data = (await res.json()) as GcalEvent;
  return { ok: true, event_id: data.id, html_link: data.htmlLink };
}

export async function deleteCalendarEvent(eventId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await getValidAccessToken();
  if (!auth) return { ok: false, error: 'Google non connecté.' };
  const res = await fetch(`${API}/calendars/primary/events/${eventId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${auth.access_token}` },
  });
  if (!res.ok && res.status !== 410) {
    const t = await res.text();
    return { ok: false, error: `Calendar HTTP ${res.status} : ${t.slice(0, 200)}` };
  }
  return { ok: true };
}

export async function getCalendarEvents(args: {
  from: Date;
  to: Date;
}): Promise<{ ok: true; events: GcalEvent[] } | { ok: false; error: string }> {
  const auth = await getValidAccessToken();
  if (!auth) return { ok: false, error: 'Google non connecté.' };
  const params = new URLSearchParams({
    timeMin: args.from.toISOString(),
    timeMax: args.to.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  });
  const res = await fetch(`${API}/calendars/primary/events?${params}`, {
    headers: { Authorization: `Bearer ${auth.access_token}` },
  });
  if (!res.ok) {
    const t = await res.text();
    return { ok: false, error: `Calendar HTTP ${res.status} : ${t.slice(0, 200)}` };
  }
  const j = (await res.json()) as { items?: GcalEvent[] };
  return { ok: true, events: j.items ?? [] };
}

// Compatibilité avec l'ancien stub utilisé par planning : import optionnel
export async function syncCalendarToCreneaux(
  _technicienId: string, _from: Date, _to: Date,
): Promise<CalendarSyncResult> {
  return { ok: true, created: 0, updated: 0, blocked: 0 };
}

// ─── Sync incrémentale (bidirectionnelle) ────────────────────────────────

export interface CalendarChangesResult {
  ok: true;
  events: GcalEvent[];
  next_sync_token: string | null;
  next_page_token: string | null;
  full_sync_required: boolean;
}

export type CalendarChanges =
  | CalendarChangesResult
  | { ok: false; error: string };

// Lit les changements Calendar depuis le dernier syncToken. Si Google
// renvoie 410 GONE, le token est expiré → full_sync_required=true et le
// caller doit relancer sans syncToken (et reset les ids locaux).
export async function getCalendarChanges(
  syncToken: string | null,
  pageToken?: string,
): Promise<CalendarChanges> {
  const auth = await getValidAccessToken();
  if (!auth) return { ok: false, error: 'Google non connecté.' };

  const params = new URLSearchParams({
    singleEvents: 'true',
    showDeleted: 'true',
  });
  if (syncToken) {
    params.set('syncToken', syncToken);
  } else {
    // Initialisation : on prend une fenêtre récente pour seed et obtenir
    // un syncToken. Sans syncToken et sans timeMin/timeMax, l'API renvoie
    // un syncToken réutilisable.
    params.set('maxResults', '1');
  }
  if (pageToken) params.set('pageToken', pageToken);

  const res = await fetch(`${API}/calendars/primary/events?${params}`, {
    headers: { Authorization: `Bearer ${auth.access_token}` },
  });
  if (res.status === 410) {
    return { ok: true, events: [], next_sync_token: null, next_page_token: null, full_sync_required: true };
  }
  if (!res.ok) {
    const t = await res.text();
    return { ok: false, error: `Calendar HTTP ${res.status} : ${t.slice(0, 200)}` };
  }
  const j = (await res.json()) as { items?: GcalEvent[]; nextSyncToken?: string; nextPageToken?: string };
  return {
    ok: true,
    events: j.items ?? [],
    next_sync_token: j.nextSyncToken ?? null,
    next_page_token: j.nextPageToken ?? null,
    full_sync_required: false,
  };
}

// ─── Watch API (push notifications via webhook) ──────────────────────────
//
// Setup :
//   POST /calendar/v3/calendars/primary/events/watch
//     { id, type: 'web_hook', address: '<APP_URL>/api/google/calendar-webhook', token }
//   Renvoie { id, resourceId, expiration (ms en string) }
//
// Téardown :
//   POST /calendar/v3/channels/stop  { id, resourceId }
//
// Durée max d'une subscription : ~7 jours (604800s). Doit être renouvelée
// par le cron /api/cron/renew-calendar-watch avant expiration.

export interface WatchSubscription {
  channel_id: string;
  resource_id: string;
  expiry_ms: number;
}

export type WatchSubscribeResult =
  | { ok: true; subscription: WatchSubscription }
  | { ok: false; error: string };

interface RawWatchResponse {
  id: string;
  resourceId: string;
  expiration?: string;     // ms (string)
}

export async function subscribeCalendarWatch(args: {
  webhookUrl: string;
  token: string;
}): Promise<WatchSubscribeResult> {
  const auth = await getValidAccessToken();
  if (!auth) return { ok: false, error: 'Google non connecté.' };

  const channelId = `foxo-calendar-watch-${Date.now()}`;
  const body = {
    id: channelId,
    type: 'web_hook',
    address: args.webhookUrl,
    token: args.token,
  };

  const res = await fetch(`${API}/calendars/primary/events/watch`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    return { ok: false, error: `Watch HTTP ${res.status} : ${t.slice(0, 300)}` };
  }
  const data = (await res.json()) as RawWatchResponse;
  return {
    ok: true,
    subscription: {
      channel_id: data.id,
      resource_id: data.resourceId,
      expiry_ms: data.expiration ? parseInt(data.expiration, 10) : 0,
    },
  };
}

export async function unsubscribeCalendarWatch(args: {
  channelId: string;
  resourceId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await getValidAccessToken();
  if (!auth) return { ok: false, error: 'Google non connecté.' };

  const res = await fetch(`${API}/channels/stop`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: args.channelId, resourceId: args.resourceId }),
  });
  // 204 No Content = succès. 404 = déjà fermé (idempotent OK).
  if (!res.ok && res.status !== 404) {
    const t = await res.text();
    return { ok: false, error: `Stop HTTP ${res.status} : ${t.slice(0, 200)}` };
  }
  return { ok: true };
}

// Helper : crée un event "Disponible FOXO" pour un créneau libre.
// `technicienHex` (optionnel) sert à colorer l'event Google Calendar
// avec le colorId le plus proche de la couleur perso du tech (settings).
export async function createSlotEvent(args: {
  startIso: string;
  endIso: string;
  technicienName?: string;
  technicienHex?: string | null;
}): Promise<CalendarEventResult> {
  const summary = args.technicienName
    ? `Disponible FoxO — ${args.technicienName}`
    : 'Disponible FoxO';
  const colorId = hexToGcalColorId(args.technicienHex) ?? undefined;
  return createCalendarEvent({
    startIso: args.startIso,
    endIso: args.endIso,
    summary,
    description: 'Créneau de disponibilité FoxO (synchronisation auto). Sera basculé en intervention si réservé.',
    colorId,
  });
}
