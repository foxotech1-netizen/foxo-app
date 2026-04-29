import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runRappelJ1 } from '@/lib/cron/rappel-j1';

export const dynamic = 'force-dynamic';

function checkAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${expected}`;
}

export async function POST(request: Request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Toggle dans parametres pour permettre de désactiver le cron sans
  // toucher Vercel.
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from('parametres')
      .select('valeur')
      .eq('cle', 'sms_auto_rappel_24h')
      .maybeSingle();
    if (data?.valeur !== 'true') {
      return NextResponse.json({
        ok: true,
        skipped_reason: 'sms_auto_rappel_24h !== true',
        sent: 0, skipped: 0, errors: [],
      });
    }
  } catch (e) {
    console.warn('[cron/rappel-j1] toggle check failed:', e);
  }

  const { result } = await runRappelJ1(false);
  return NextResponse.json({ ok: true, ...result });
}
