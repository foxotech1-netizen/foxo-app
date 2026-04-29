import { NextResponse } from 'next/server';
import { runCheckMails } from '@/lib/cron/check-mails';

export const dynamic = 'force-dynamic';

// Auth via query param ?secret=xxx pour permettre les tests manuels
// depuis le navigateur (dry-run, ne crée rien, ne touche pas à Gmail).
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
  const result = await runCheckMails(true);
  return NextResponse.json({ ok: true, dry_run: true, ...result });
}
