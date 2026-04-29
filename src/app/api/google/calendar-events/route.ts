import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';
import { getCalendarEvents } from '@/lib/google-calendar';
import { loadTokens } from '@/lib/google-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
};

// Détecte si un event Calendar a déjà été importé comme intervention FoxO.
// Le marqueur est inséré par /api/google/calendar-import dans la description :
//   "foxo-ref:<intervention_uuid>" sur sa propre ligne.
const FOXO_REF_RE = /foxo-ref:[a-f0-9-]{36}/i;

function isFoxoEvent(description: string | null | undefined): boolean {
  const d = description ?? '';
  return FOXO_REF_RE.test(d);
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403, headers: NO_STORE });
  }

  // Si Google non connecté → renvoie events:[] sans erreur (UI gère)
  const tokens = await loadTokens();
  if (!tokens?.access_token || !tokens?.refresh_token) {
    return NextResponse.json(
      { ok: true, events: [], google_connected: false },
      { headers: NO_STORE },
    );
  }

  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!from || !to) {
    return NextResponse.json({ ok: false, error: 'from/to requis (YYYY-MM-DD).' }, { status: 400, headers: NO_STORE });
  }

  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T23:59:59.999Z`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return NextResponse.json({ ok: false, error: 'Dates invalides.' }, { status: 400, headers: NO_STORE });
  }

  const res = await getCalendarEvents({ from: fromDate, to: toDate });
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: res.error }, { status: 502, headers: NO_STORE });
  }

  const events = res.events.map((e) => {
    // start/end peuvent être des "all-day" (date YYYY-MM-DD) ou timed (dateTime ISO).
    const start = e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00` : '');
    const end = e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T23:59:59` : '');
    return {
      id: e.id,
      title: e.summary ?? '(sans titre)',
      start,
      end,
      description: e.description ?? '',
      location: e.location ?? '',
      is_foxo_event: isFoxoEvent(e.description),
      all_day: !e.start?.dateTime,
    };
  });

  return NextResponse.json(
    { ok: true, events, google_connected: true },
    { headers: NO_STORE },
  );
}
