import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';
import { modifyMailLabels } from '@/lib/gmail';

export const dynamic = 'force-dynamic';

interface PatchBody {
  addLabelIds?: unknown;
  removeLabelIds?: unknown;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { id } = await params;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }
  const add = Array.isArray(body.addLabelIds)
    ? body.addLabelIds.filter((x): x is string => typeof x === 'string')
    : undefined;
  const rem = Array.isArray(body.removeLabelIds)
    ? body.removeLabelIds.filter((x): x is string => typeof x === 'string')
    : undefined;

  const res = await modifyMailLabels({ mailId: id, addLabelIds: add, removeLabelIds: rem });
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 502 });
  return NextResponse.json({ ok: true });
}
