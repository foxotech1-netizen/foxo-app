// OAuth2 Google + gestion automatique du refresh.
//
// Variables d'env :
//   - GOOGLE_CLIENT_ID
//   - GOOGLE_CLIENT_SECRET
//   - NEXT_PUBLIC_APP_URL (pour construire le redirect_uri)
//
// Le redirect_uri DOIT être déclaré dans la console Google Cloud :
//   https://app.foxo.be/api/google/callback (et localhost en dev)

import { createAdminClient } from '@/lib/supabase/admin';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/userinfo.email',
];

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

function getRedirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.foxo.be';
  return `${base.replace(/\/$/, '')}/api/google/callback`;
}

export function buildAuthUrl(state: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID manquant.');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',           // pour récupérer un refresh_token
    prompt: 'consent',                 // force l'émission d'un refresh_token
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

interface TokenExchangeResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

export async function exchangeCodeForTokens(code: string): Promise<{
  ok: true;
  access_token: string;
  refresh_token?: string;
  expiry: Date;
  scope?: string;
  email?: string;
} | { ok: false; error: string }> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return { ok: false, error: 'Credentials Google manquants côté serveur.' };
  }
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: getRedirectUri(),
    grant_type: 'authorization_code',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const txt = await res.text();
    return { ok: false, error: `Échec d'échange du code : HTTP ${res.status} ${txt.slice(0, 200)}` };
  }
  const data = (await res.json()) as TokenExchangeResponse;
  if (data.error) return { ok: false, error: `${data.error}: ${data.error_description ?? ''}` };

  // Récupère l'email du compte connecté
  let email: string | undefined;
  try {
    const ui = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    if (ui.ok) {
      const j = await ui.json() as { email?: string };
      email = j.email;
    }
  } catch { /* noop */ }

  return {
    ok: true,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry: new Date(Date.now() + data.expires_in * 1000),
    scope: data.scope,
    email,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  ok: true; access_token: string; expiry: Date;
} | { ok: false; error: string }> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return { ok: false, error: 'Credentials Google manquants.' };

  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const txt = await res.text();
    return { ok: false, error: `Refresh failed : HTTP ${res.status} ${txt.slice(0, 200)}` };
  }
  const data = (await res.json()) as TokenExchangeResponse;
  if (data.error) return { ok: false, error: `${data.error}: ${data.error_description ?? ''}` };
  return {
    ok: true,
    access_token: data.access_token,
    expiry: new Date(Date.now() + data.expires_in * 1000),
  };
}

// ─── Persistance Supabase (table google_tokens) ──────────────────────────

interface GoogleTokensRow {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
  expiry: string | null;
  scope: string | null;
  email: string | null;
  updated_at: string;
}

export async function saveTokens(input: {
  access_token: string;
  refresh_token?: string;
  expiry: Date;
  scope?: string;
  email?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();
  // On garde une seule ligne "active" → upsert sur la dernière.
  const { data: existing } = await admin
    .from('google_tokens')
    .select('id, refresh_token')
    .order('updated_at', { ascending: false })
    .limit(1);

  const payload: Record<string, unknown> = {
    access_token: input.access_token,
    expiry: input.expiry.toISOString(),
    scope: input.scope ?? null,
    email: input.email ?? null,
    updated_at: new Date().toISOString(),
  };
  // Si on a reçu un nouveau refresh_token, on le sauve. Sinon on garde
  // l'ancien (Google ne renvoie pas de refresh_token aux refreshes).
  if (input.refresh_token) payload.refresh_token = input.refresh_token;

  if (existing && existing.length > 0) {
    const { error } = await admin.from('google_tokens').update(payload).eq('id', existing[0].id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }
  const { error } = await admin.from('google_tokens').insert(payload);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function loadTokens(): Promise<GoogleTokensRow | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from('google_tokens')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as GoogleTokensRow | null) ?? null;
  } catch {
    return null;
  }
}

export async function clearTokens(): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from('google_tokens').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  } catch { /* noop */ }
}

// Renvoie un access_token valide en effectuant un refresh si nécessaire.
// Retourne null si aucun compte Google n'est connecté.
export async function getValidAccessToken(): Promise<{ access_token: string; email: string | null } | null> {
  const row = await loadTokens();
  if (!row) {
    console.error('[mails-debug] getValidAccessToken: aucune ligne google_tokens en DB');
    return null;
  }
  if (!row.access_token) {
    console.error('[mails-debug] getValidAccessToken: row trouvée mais access_token vide', { email: row.email, hasRefresh: !!row.refresh_token });
    return null;
  }

  const now = Date.now();
  const expiryMs = row.expiry ? new Date(row.expiry).getTime() : 0;
  const remainingS = Math.round((expiryMs - now) / 1000);
  console.error('[mails-debug] getValidAccessToken: token loaded', { email: row.email, expiry_in_s: remainingS, scope: row.scope?.slice(0, 80) });

  // Marge de 60s pour éviter les races
  if (expiryMs - now > 60_000) {
    return { access_token: row.access_token, email: row.email };
  }

  // Token expiré → refresh si possible
  if (!row.refresh_token) {
    console.error('[mails-debug] getValidAccessToken: token expiré ET pas de refresh_token → null');
    return null;
  }
  console.error('[mails-debug] getValidAccessToken: refresh nécessaire…');
  const r = await refreshAccessToken(row.refresh_token);
  if (!r.ok) {
    console.error('[mails-debug] getValidAccessToken: refresh FAILED:', r.error);
    return null;
  }
  console.error('[mails-debug] getValidAccessToken: refresh OK');
  await saveTokens({
    access_token: r.access_token,
    expiry: r.expiry,
    email: row.email ?? undefined,
    scope: row.scope ?? undefined,
  });
  return { access_token: r.access_token, email: row.email };
}

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}
