import { NextResponse } from 'next/server';
import { runRappelJ1 } from '@/lib/cron/rappel-j1';

export const dynamic = 'force-dynamic';

function checkAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${expected}`;
}

export async function GET(request: Request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { result, dryDetails } = await runRappelJ1(true);
  return NextResponse.json({ ok: true, ...result, would_send: dryDetails });
}
