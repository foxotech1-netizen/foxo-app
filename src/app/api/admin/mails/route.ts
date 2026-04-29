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

  const res = await listInboxMails({ limit, q });
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 502 });
  return NextResponse.json({ ok: true, mails: res.mails });
}
