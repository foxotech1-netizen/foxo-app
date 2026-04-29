import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';
import { getMailDetail, deleteMailPermanently } from '@/lib/gmail';

export const dynamic = 'force-dynamic';

async function assertAdmin(): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return { ok: false, status: 403, error: 'Accès refusé.' };
  }
  return { ok: true };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await assertAdmin();
  if (!guard.ok) return NextResponse.json({ ok: false, error: guard.error }, { status: guard.status });
  const { id } = await params;
  const res = await getMailDetail(id);
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 502 });
  return NextResponse.json({ ok: true, mail: res.mail });
}

// Suppression définitive (irréversible — le mail disparaît de la corbeille).
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await assertAdmin();
  if (!guard.ok) return NextResponse.json({ ok: false, error: guard.error }, { status: guard.status });
  const { id } = await params;
  const res = await deleteMailPermanently(id);
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 502 });
  return NextResponse.json({ ok: true });
}
