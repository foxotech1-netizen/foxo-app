import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from "@/lib/auth/server";

export const dynamic = 'force-dynamic';

interface PatchBody {
  email?: unknown;
  prenom?: unknown;
  nom?: unknown;
  telephone?: unknown;
  role?: unknown;
  actif?: unknown;
}

const ALLOWED_ROLES = new Set(['admin', 'delegue']);

function sanitize(b: PatchBody): Record<string, string | boolean | null> {
  const out: Record<string, string | boolean | null> = {};
  if (typeof b.email === 'string' && b.email.trim().includes('@')) out.email = b.email.trim().toLowerCase();
  for (const k of ['prenom', 'nom', 'telephone'] as const) {
    if (typeof b[k] === 'string') {
      const v = (b[k] as string).trim();
      out[k] = v || null;
    }
  }
  if (typeof b.role === 'string' && ALLOWED_ROLES.has(b.role)) out.role = b.role;
  if (typeof b.actif === 'boolean') out.actif = b.actif;
  return out;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ org_id: string; id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { id } = await params;
  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }
  const fields = sanitize(body);
  if (Object.keys(fields).length === 0) return NextResponse.json({ ok: true, no_changes: true });
  const { error } = await supabase.from('delegues').update(fields).eq('id', id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ org_id: string; id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { id } = await params;
  const { error } = await supabase.from('delegues').delete().eq('id', id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
