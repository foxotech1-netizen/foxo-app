import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';
import { subscribeCalendarWatch } from '@/lib/google-calendar';
import { saveWatchState } from '@/lib/calendar-watch-state';

export const dynamic = 'force-dynamic';

// Crée une nouvelle subscription Watch Google Calendar et persiste
// channel_id / resource_id / expiry dans `parametres`.
//
// L'URL du webhook est construite depuis NEXT_PUBLIC_APP_URL (et non
// le host de la requête) parce que Google Calendar exige un HTTPS
// stable et déclaré pour l'event push (admin.foxo.be en prod).
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    return NextResponse.json({ ok: false, error: 'NEXT_PUBLIC_APP_URL non défini.' }, { status: 500 });
  }
  const token = process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN;
  if (!token) {
    return NextResponse.json({ ok: false, error: 'GOOGLE_CALENDAR_WEBHOOK_TOKEN non défini.' }, { status: 500 });
  }

  const webhookUrl = `${appUrl.replace(/\/$/, '')}/api/google/calendar-webhook`;

  const sub = await subscribeCalendarWatch({ webhookUrl, token });
  if (!sub.ok) {
    return NextResponse.json({ ok: false, error: sub.error }, { status: 502 });
  }

  const saved = await saveWatchState({
    channel_id: sub.subscription.channel_id,
    resource_id: sub.subscription.resource_id,
    expiry_ms: sub.subscription.expiry_ms,
  });
  if (!saved.ok) {
    return NextResponse.json({ ok: false, error: saved.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    channel_id: sub.subscription.channel_id,
    resource_id: sub.subscription.resource_id,
    expiry: sub.subscription.expiry_ms,
    expiry_iso: new Date(sub.subscription.expiry_ms).toISOString(),
  });
}
