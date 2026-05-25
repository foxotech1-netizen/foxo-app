import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from "@/lib/auth/server";
import { unsubscribeCalendarWatch } from '@/lib/google-calendar';
import { loadWatchState, clearWatchState } from '@/lib/calendar-watch-state';

export const dynamic = 'force-dynamic';

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

  const state = await loadWatchState();
  if (!state.channel_id || !state.resource_id) {
    // Pas de subscription active → on s'assure que les paramètres sont vides
    await clearWatchState();
    return NextResponse.json({ ok: true, was_active: false });
  }

  const stop = await unsubscribeCalendarWatch({
    channelId: state.channel_id,
    resourceId: state.resource_id,
  });
  // On vide les params même si stop a échoué (channel peut être déjà mort
  // côté Google) — sinon on ne pourrait plus en recréer un.
  await clearWatchState();

  if (!stop.ok) {
    return NextResponse.json({ ok: true, was_active: true, stop_warning: stop.error });
  }
  return NextResponse.json({ ok: true, was_active: true });
}
