import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCalendarChanges } from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';

// Webhook push notifications Google Calendar.
//
// Setup : appeler une fois POST /calendar/v3/calendars/primary/events/watch
// avec { id, type:'web_hook', address:'<APP_URL>/api/google/calendar-webhook',
// token: <secret> } pour démarrer la subscription. Google enverra des POST
// vides (juste headers X-Goog-*) à chaque changement. On répond 200 et on
// pull les changements via getCalendarChanges (syncToken).
//
// Headers reçus :
//   X-Goog-Channel-Id, X-Goog-Resource-Id, X-Goog-Resource-State (sync,
//   exists, not_exists), X-Goog-Channel-Token (pour vérif).
export async function POST(request: Request) {
  const expectedToken = process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN;
  const headerToken = request.headers.get('x-goog-channel-token');
  if (expectedToken && headerToken !== expectedToken) {
    return NextResponse.json({ ok: false, error: 'Bad token' }, { status: 401 });
  }

  const state = request.headers.get('x-goog-resource-state');
  // 'sync' = ping initial à la création de la subscription, on ignore.
  if (state === 'sync') return NextResponse.json({ ok: true, ignored: 'sync' });

  // Lit le syncToken courant et applique les changements
  const admin = createAdminClient();
  const { data: tokRow } = await admin
    .from('parametres')
    .select('valeur')
    .eq('cle', 'gcal_sync_token')
    .maybeSingle();
  let token = (tokRow?.valeur as string | null) ?? null;

  let pulled = 0;
  while (true) {
    const r = await getCalendarChanges(token, undefined);
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 502 });
    if (r.full_sync_required) { token = null; continue; }
    pulled += r.events.length;
    for (const ev of r.events) {
      const status = (ev as unknown as { status?: string }).status;
      if (status === 'cancelled') {
        await admin
          .from('creneaux_disponibles')
          .delete()
          .eq('google_event_id', ev.id)
          .eq('statut', 'libre');
      }
    }
    if (!r.next_page_token) {
      if (r.next_sync_token) {
        await admin
          .from('parametres')
          .upsert(
            { cle: 'gcal_sync_token', valeur: r.next_sync_token, updated_at: new Date().toISOString() },
            { onConflict: 'cle' },
          );
      }
      break;
    }
    token = r.next_page_token;
  }

  return NextResponse.json({ ok: true, pulled });
}
