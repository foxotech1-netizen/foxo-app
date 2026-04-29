import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';
import { listGmailLabels, createGmailLabel } from '@/lib/gmail';

export const dynamic = 'force-dynamic';

async function assertAdmin(): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return { ok: false, status: 403, error: 'Accès refusé.' };
  }
  return { ok: true };
}

export async function GET() {
  const guard = await assertAdmin();
  if (!guard.ok) return NextResponse.json({ ok: false, error: guard.error }, { status: guard.status });

  const res = await listGmailLabels();
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 502 });
  return NextResponse.json({ ok: true, labels: res.labels });
}

interface CreateLabelBody {
  name?: unknown;
  textColor?: unknown;
  backgroundColor?: unknown;
}

export async function POST(request: Request) {
  const guard = await assertAdmin();
  if (!guard.ok) return NextResponse.json({ ok: false, error: guard.error }, { status: guard.status });

  let body: CreateLabelBody;
  try {
    body = (await request.json()) as CreateLabelBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ ok: false, error: 'Nom de libellé requis.' }, { status: 400 });

  const textColor = typeof body.textColor === 'string' ? body.textColor : undefined;
  const backgroundColor = typeof body.backgroundColor === 'string' ? body.backgroundColor : undefined;

  const res = await createGmailLabel({ name, textColor, backgroundColor });
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 502 });
  return NextResponse.json({ ok: true, label: res.label });
}
