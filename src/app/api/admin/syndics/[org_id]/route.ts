import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from "@/lib/auth/server";

export const dynamic = 'force-dynamic';

interface PatchBody {
  nom?: unknown;
  type?: unknown;
  email?: unknown;
  contact?: unknown;
  telephone?: unknown;
  bce?: unknown;
  adresse?: unknown;
  email_factures?: unknown;
  email_rapports?: unknown;
  email_communications?: unknown;
}

const VALID_TYPES = new Set(['syndic', 'courtier']);

// Sanitize : trim + map empty → null pour les champs string.
// `type` est traité à part (enum strict, pas de null possible).
// Renvoie `{ fields, error }` — error si une valeur invalide est passée.
function sanitize(b: PatchBody): {
  fields: Record<string, string | null>;
  error: string | null;
} {
  const out: Record<string, string | null> = {};
  const stringFields: (keyof PatchBody)[] = [
    'nom', 'email', 'contact', 'telephone', 'bce', 'adresse',
    'email_factures', 'email_rapports', 'email_communications',
  ];
  for (const k of stringFields) {
    if (typeof b[k] === 'string') {
      const v = (b[k] as string).trim();
      out[k] = v || null;
    } else if (b[k] === null) {
      out[k] = null;
    }
  }
  if (typeof b.type === 'string') {
    const t = (b.type as string).trim();
    if (!VALID_TYPES.has(t)) {
      return { fields: out, error: `Type invalide : "${t}" (attendu : syndic ou courtier).` };
    }
    out.type = t;
  }
  return { fields: out, error: null };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ org_id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { org_id } = await params;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }
  const { fields, error: validationErr } = sanitize(body);
  if (validationErr) return NextResponse.json({ ok: false, error: validationErr }, { status: 400 });
  if (Object.keys(fields).length === 0) return NextResponse.json({ ok: true, no_changes: true });

  const { error } = await supabase.from('organisations').update(fields).eq('id', org_id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
