import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from "@/lib/auth/server";
import { batchModifyMails, batchDeletePermanently } from '@/lib/gmail';

export const dynamic = 'force-dynamic';

type BatchAction =
  | 'read'
  | 'unread'
  | 'archive'
  | 'label'
  | 'important'
  | 'trash'
  | 'restore'
  | 'delete-permanent';

interface BatchBody {
  ids?: unknown;
  action?: unknown;
  labelId?: unknown;     // requis si action='label'
}

const ALLOWED_ACTIONS: BatchAction[] = [
  'read', 'unread', 'archive',
  'label', 'important', 'trash', 'restore', 'delete-permanent',
];

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
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
  const labelId = typeof body.labelId === 'string' ? body.labelId : undefined;

  if (ids.length === 0) {
    return NextResponse.json({ ok: false, error: 'Aucun id fourni.' }, { status: 400 });
  }
  if (!ALLOWED_ACTIONS.includes(action)) {
    return NextResponse.json({ ok: false, error: 'Action inconnue.' }, { status: 400 });
  }

  // Suppression définitive — endpoint distinct
  if (action === 'delete-permanent') {
    const res = await batchDeletePermanently(ids);
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 502 });
    return NextResponse.json({ ok: true, count: ids.length });
  }

  // Toutes les autres actions passent par batchModify
  let addLabelIds: string[] | undefined;
  let removeLabelIds: string[] | undefined;

  if (action === 'read') {
    removeLabelIds = ['UNREAD'];
  } else if (action === 'unread') {
    addLabelIds = ['UNREAD'];
  } else if (action === 'archive') {
    removeLabelIds = ['INBOX'];
  } else if (action === 'important') {
    addLabelIds = ['IMPORTANT'];
  } else if (action === 'trash') {
    addLabelIds = ['TRASH'];
    removeLabelIds = ['INBOX'];
  } else if (action === 'restore') {
    addLabelIds = ['INBOX'];
    removeLabelIds = ['TRASH'];
  } else if (action === 'label') {
    if (!labelId) return NextResponse.json({ ok: false, error: 'labelId requis.' }, { status: 400 });
    addLabelIds = [labelId];
  }

  const res = await batchModifyMails({ ids, addLabelIds, removeLabelIds });
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 502 });
  return NextResponse.json({ ok: true, count: ids.length });
}
