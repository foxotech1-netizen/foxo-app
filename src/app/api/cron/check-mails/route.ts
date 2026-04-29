import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runCheckMails } from '@/lib/cron/check-mails';

export const dynamic = 'force-dynamic';

function checkBearer(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return (req.headers.get('authorization') ?? '') === `Bearer ${expected}`;
}

async function handle(request: Request): Promise<Response> {
  if (!checkBearer(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Toggle parametres.mail_auto_analyse — désactive sans toucher à Vercel
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from('parametres')
      .select('valeur')
      .eq('cle', 'mail_auto_analyse')
      .maybeSingle();
    if (data?.valeur !== 'true') {
      return NextResponse.json({
        ok: true,
        skipped_reason: 'mail_auto_analyse !== true',
        processed: 0, created: 0, labeled_lu: 0, skipped: 0, errors: 0, items: [],
      });
    }
  } catch (e) {
    console.warn('[cron/check-mails] toggle check failed:', e);
  }

  const result = await runCheckMails(false);
  return NextResponse.json({ ok: true, ...result });
}

// Vercel cron pousse en GET ; le bouton "Vérifier maintenant" pousse en POST.
export async function GET(request: Request) { return handle(request); }
export async function POST(request: Request) { return handle(request); }
