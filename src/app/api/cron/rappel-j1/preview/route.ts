import { NextResponse } from 'next/server';
import { runRappelJ1 } from '@/lib/cron/rappel-j1';

export const dynamic = 'force-dynamic';

// Auth via query param ?secret=xxx pour permettre les tests manuels
// depuis le navigateur. À retirer / remplacer par le header Bearer
// quand l'endpoint sera promu vers un vrai cron.
function checkSecret(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const url = new URL(request.url);
  return url.searchParams.get('secret') === expected;
}

export async function GET(request: Request) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { result, dryDetails } = await runRappelJ1(true);
  return NextResponse.json({ ok: true, ...result, would_send: dryDetails });
}
