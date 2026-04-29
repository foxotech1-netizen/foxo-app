import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';
import { sendMailReply } from '@/lib/gmail';

export const dynamic = 'force-dynamic';

interface ReplyBody {
  body?: unknown;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

  const { id } = await params;

  let parsed: ReplyBody;
  try {
    parsed = (await request.json()) as ReplyBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }
  const text = typeof parsed.body === 'string' ? parsed.body : '';
  if (!text.trim()) {
    return NextResponse.json({ ok: false, error: 'Corps de réponse vide.' }, { status: 400 });
  }

  const res = await sendMailReply({ mailId: id, body: text });
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 502 });
  return NextResponse.json({ ok: true, messageId: res.id });
}
