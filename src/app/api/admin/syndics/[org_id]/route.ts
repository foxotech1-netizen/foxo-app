import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

interface PatchBody {
  nom?: unknown;
  email?: unknown;
  contact?: unknown;
  telephone?: unknown;
  bce?: unknown;
  adresse?: unknown;
  email_factures?: unknown;
  email_rapports?: unknown;
  email_communications?: unknown;
}

function sanitize(b: PatchBody): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const fields: (keyof PatchBody)[] = [
    'nom', 'email', 'contact', 'telephone', 'bce', 'adresse',
    'email_factures', 'email_rapports', 'email_communications',
  ];
  for (const k of fields) {
    if (typeof b[k] === 'string') {
      const v = (b[k] as string).trim();
      out[k] = v || null;
    } else if (b[k] === null) {
      out[k] = null;
    }
  }
  return out;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ org_id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { org_id } = await params;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }
  const fields = sanitize(body);
  if (Object.keys(fields).length === 0) return NextResponse.json({ ok: true, no_changes: true });

  const { error } = await supabase.from('organisations').update(fields).eq('id', org_id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
