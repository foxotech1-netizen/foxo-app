import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';
import { batchModifyMails, ensureLabel } from '@/lib/gmail';

export const dynamic = 'force-dynamic';

type BatchAction = 'read' | 'unread' | 'traite' | 'archive';

interface BatchBody {
  ids?: unknown;
  action?: unknown;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

  let body: BatchBody;
  try {
    body = (await request.json()) as BatchBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : [];
  const action = body.action as BatchAction;
  if (ids.length === 0) {
    return NextResponse.json({ ok: false, error: 'Aucun id fourni.' }, { status: 400 });
  }
  if (!['read', 'unread', 'traite', 'archive'].includes(action)) {
    return NextResponse.json({ ok: false, error: 'Action inconnue.' }, { status: 400 });
  }

  let addLabelIds: string[] | undefined;
  let removeLabelIds: string[] | undefined;

  if (action === 'read') {
    removeLabelIds = ['UNREAD'];
  } else if (action === 'unread') {
    addLabelIds = ['UNREAD'];
  } else if (action === 'traite') {
    const ensured = await ensureLabel('FOXO_TRAITE');
    if (!ensured.ok) return NextResponse.json({ ok: false, error: ensured.error }, { status: 502 });
    addLabelIds = [ensured.label_id];
    removeLabelIds = ['UNREAD'];
  } else if (action === 'archive') {
    removeLabelIds = ['INBOX'];
  }

  const res = await batchModifyMails({ ids, addLabelIds, removeLabelIds });
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 502 });
  return NextResponse.json({ ok: true, count: ids.length });
}
