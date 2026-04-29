import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { id } = await params;
  const { data, error } = await supabase
    .from('clients')
    .select('id, type, nom, prenom, email, telephone, created_at')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: 'Introuvable.' }, { status: 404 });
  return NextResponse.json({ ok: true, client: data });
}
