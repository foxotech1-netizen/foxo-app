// Persistance de l'état de la subscription Watch Google Calendar dans
// la table `parametres`. Sert de source de vérité partagée entre :
//   - /api/google/calendar-watch/subscribe        (création)
//   - /api/google/calendar-watch/unsubscribe      (arrêt)
//   - /api/cron/renew-calendar-watch              (rotation auto)
//   - /admin/parametres                           (affichage statut)

import { createAdminClient } from '@/lib/supabase/admin';

export interface WatchState {
  channel_id: string | null;
  resource_id: string | null;
  expiry_ms: number;
}

export async function loadWatchState(): Promise<WatchState> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('parametres')
    .select('cle, valeur')
    .in('cle', ['calendar_watch_channel_id', 'calendar_watch_resource_id', 'calendar_watch_expiry']);
  const map: Record<string, string | null> = {};
  for (const row of data ?? []) map[row.cle as string] = (row.valeur as string | null) ?? null;
  const channelId = map['calendar_watch_channel_id'] || null;
  const resourceId = map['calendar_watch_resource_id'] || null;
  const expiry = map['calendar_watch_expiry'] ? parseInt(map['calendar_watch_expiry'], 10) : 0;
  return {
    channel_id: channelId,
    resource_id: resourceId,
    expiry_ms: Number.isFinite(expiry) ? expiry : 0,
  };
}

export async function saveWatchState(s: WatchState): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const rows = [
    { cle: 'calendar_watch_channel_id',  valeur: s.channel_id ?? '',  updated_at: now },
    { cle: 'calendar_watch_resource_id', valeur: s.resource_id ?? '', updated_at: now },
    { cle: 'calendar_watch_expiry',      valeur: String(s.expiry_ms), updated_at: now },
  ];
  const { error } = await admin.from('parametres').upsert(rows, { onConflict: 'cle' });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function clearWatchState(): Promise<void> {
  await saveWatchState({ channel_id: null, resource_id: null, expiry_ms: 0 });
}

export function watchStatus(state: WatchState): 'inactive' | 'active' | 'expiring_soon' | 'expired' {
  if (!state.channel_id || !state.resource_id || state.expiry_ms <= 0) return 'inactive';
  const now = Date.now();
  if (state.expiry_ms <= now) return 'expired';
  if (state.expiry_ms - now < 24 * 60 * 60 * 1000) return 'expiring_soon';
  return 'active';
}
