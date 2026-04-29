import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

interface CreateBody {
  email?: unknown;
  prenom?: unknown;
  nom?: unknown;
  telephone?: unknown;
  role?: unknown;       // 'admin' | 'delegue'
}

const ALLOWED_ROLES = new Set(['admin', 'delegue']);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ org_id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { org_id } = await params;
  const { data, error } = await supabase
    .from('delegues')
    .select('id, organisation_id, email, prenom, nom, telephone, role, actif, invite_sent_at, created_at')
    .eq('organisation_id', org_id)
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, delegues: data ?? [] });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ org_id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { org_id } = await params;

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !email.includes('@')) {
    return NextResponse.json({ ok: false, error: 'Email requis.' }, { status: 400 });
  }
  const role = typeof body.role === 'string' && ALLOWED_ROLES.has(body.role) ? body.role : 'delegue';
  const insert = {
    organisation_id: org_id,
    email,
    prenom: typeof body.prenom === 'string' && body.prenom.trim() ? body.prenom.trim() : null,
    nom: typeof body.nom === 'string' && body.nom.trim() ? body.nom.trim() : null,
    telephone: typeof body.telephone === 'string' && body.telephone.trim() ? body.telephone.trim() : null,
    role,
    actif: true,
  };

  const { data, error } = await supabase
    .from('delegues')
    .insert(insert)
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ ok: false, error: 'Cet email est déjà délégué de cette organisation.' }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, delegue: data });
}
