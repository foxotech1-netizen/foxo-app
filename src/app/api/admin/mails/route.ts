import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';
import { listInboxMails } from '@/lib/gmail';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') ?? '30', 10) || 30;
  const filter = url.searchParams.get('filter');
  // Filtre Gmail :
  //   filter=unread → "in:inbox is:unread"
  //   filter=traite → "in:inbox label:FOXO_TRAITE"
  //   sinon défaut "in:inbox"
  let q = 'in:inbox';
  if (filter === 'unread') q = 'in:inbox is:unread';

  console.error('[mails-debug] GET /api/admin/mails', { limit, filter, q, user_email: user.email });

  const res = await listInboxMails({ limit, q });
  if (!res.ok) {
    console.error('[mails-debug] listInboxMails FAILED:', res.error);
    return NextResponse.json({ ok: false, error: res.error }, { status: 502 });
  }
  console.error('[mails-debug] listInboxMails OK:', { count: res.mails.length, sample: res.mails.slice(0, 2).map((m) => ({ id: m.id, from: m.from, subject: m.subject })) });
  return NextResponse.json({ ok: true, mails: res.mails });
}
