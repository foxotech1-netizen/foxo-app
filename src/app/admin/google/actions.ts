'use server';

import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';
import { clearTokens, getValidAccessToken, loadTokens } from '@/lib/google-auth';
import { testDriveConnection } from '@/lib/google-drive';
import { getCalendarEvents } from '@/lib/google-calendar';
import { searchEmailsByDossier } from '@/lib/gmail';

type R<T = void> = { ok: true; data?: T } | { ok: false; error: string };

async function assertAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return { ok: false, error: 'Accès refusé.' };
  }
  return { ok: true };
}

export async function getGoogleStatus(): Promise<R<{
  connected: boolean;
  email: string | null;
  scope: string | null;
  expiry: string | null;
}>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  const row = await loadTokens();
  if (!row) return { ok: true, data: { connected: false, email: null, scope: null, expiry: null } };
  return {
    ok: true,
    data: {
      connected: Boolean(row.access_token && row.refresh_token),
      email: row.email,
      scope: row.scope,
      expiry: row.expiry,
    },
  };
}

export async function disconnectGoogle(): Promise<R> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  await clearTokens();
  return { ok: true };
}

export async function testGoogleDrive(): Promise<R<{ root_rapports?: string; root_factures?: string }>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  const r = await testDriveConnection();
  if (!r.ok) return { ok: false, error: r.error ?? 'Drive inaccessible.' };
  return { ok: true, data: { root_rapports: r.root_rapports, root_factures: r.root_factures } };
}

export async function testGoogleCalendar(): Promise<R<{ count: number }>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  const auth = await getValidAccessToken();
  if (!auth) return { ok: false, error: 'Google non connecté.' };
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
  const r = await getCalendarEvents({ from: now, to: tomorrow });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, data: { count: r.events.length } };
}

export async function testGmail(): Promise<R<{ count: number }>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  const auth = await getValidAccessToken();
  if (!auth) return { ok: false, error: 'Google non connecté.' };
  // Cherche n'importe quel email récent (max 5) pour valider l'accès
  const r = await searchEmailsByDossier({ ref: 'newer_than:30d', limit: 5 });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, data: { count: r.emails.length } };
}
