import { NextResponse } from 'next/server';
import {
  subscribeCalendarWatch,
  unsubscribeCalendarWatch,
} from '@/lib/google-calendar';
import {
  loadWatchState,
  saveWatchState,
} from '@/lib/calendar-watch-state';

export const dynamic = 'force-dynamic';

// Cron quotidien (GitHub Actions, 6h UTC). Pas d'auth user — Bearer
// CRON_SECRET partagé.
//
// Comportement :
//   - Pas de subscription en DB                   → en crée une (action: 'created')
//   - Expire dans <24h ou déjà expiré             → renouvelle (action: 'renewed')
//   - Expire dans >24h                            → skip       (action: 'skipped')
function checkBearer(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return (req.headers.get('authorization') ?? '') === `Bearer ${expected}`;
}

async function handle(request: Request): Promise<Response> {
  if (!checkBearer(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const token = process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN;
  if (!appUrl) return NextResponse.json({ ok: false, error: 'NEXT_PUBLIC_APP_URL manquant.' }, { status: 500 });
  if (!token) return NextResponse.json({ ok: false, error: 'GOOGLE_CALENDAR_WEBHOOK_TOKEN manquant.' }, { status: 500 });
  const webhookUrl = `${appUrl.replace(/\/$/, '')}/api/google/calendar-webhook`;

  const state = await loadWatchState();
  const now = Date.now();
  const HOUR24 = 24 * 60 * 60 * 1000;
  const hasActive = Boolean(state.channel_id && state.resource_id) && state.expiry_ms > 0;
  const expiringSoon = hasActive && state.expiry_ms - now < HOUR24;

  // Cas 1 : pas de subscription → en créer une
  if (!hasActive) {
    const sub = await subscribeCalendarWatch({ webhookUrl, token });
    if (!sub.ok) return NextResponse.json({ ok: false, error: sub.error }, { status: 502 });
    await saveWatchState({
      channel_id: sub.subscription.channel_id,
      resource_id: sub.subscription.resource_id,
      expiry_ms: sub.subscription.expiry_ms,
    });
    return NextResponse.json({
      ok: true,
      action: 'created',
      new_expiry: sub.subscription.expiry_ms,
      new_expiry_iso: new Date(sub.subscription.expiry_ms).toISOString(),
    });
  }

  // Cas 2 : encore valide >24h → skip
  if (!expiringSoon) {
    return NextResponse.json({
      ok: true,
      action: 'skipped',
      current_expiry: state.expiry_ms,
      current_expiry_iso: new Date(state.expiry_ms).toISOString(),
      ms_remaining: state.expiry_ms - now,
    });
  }

  // Cas 3 : expiring → stop ancien channel (best-effort) puis créer le nouveau
  if (state.channel_id && state.resource_id) {
    const stop = await unsubscribeCalendarWatch({
      channelId: state.channel_id,
      resourceId: state.resource_id,
    });
    if (!stop.ok) {
      // On log mais on continue — le channel peut déjà être mort côté Google
      console.warn('[cron/renew-calendar-watch] stop ancien channel échoué :', stop.error);
    }
  }

  const sub = await subscribeCalendarWatch({ webhookUrl, token });
  if (!sub.ok) {
    // L'ancien est déjà arrêté → on vide pour permettre une retry au prochain cron
    await saveWatchState({ channel_id: null, resource_id: null, expiry_ms: 0 });
    return NextResponse.json({ ok: false, action: 'renew_failed', error: sub.error }, { status: 502 });
  }
  await saveWatchState({
    channel_id: sub.subscription.channel_id,
    resource_id: sub.subscription.resource_id,
    expiry_ms: sub.subscription.expiry_ms,
  });
  return NextResponse.json({
    ok: true,
    action: 'renewed',
    new_expiry: sub.subscription.expiry_ms,
    new_expiry_iso: new Date(sub.subscription.expiry_ms).toISOString(),
  });
}

export async function POST(request: Request) { return handle(request); }
export async function GET(request: Request)  { return handle(request); }
