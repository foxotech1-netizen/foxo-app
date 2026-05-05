import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

interface OccupantPatch {
  appartement?: unknown;
  etage?: unknown;
  prenom?: unknown;
  nom?: unknown;
  email?: unknown;
  telephone?: unknown;
  instructions?: unknown;
  contact_preference?: unknown;
  type_occupant?: unknown;
}

const ALLOWED_PREF = new Set(['email', 'sms', 'whatsapp', 'both']);
// Doit rester aligné avec le CHECK SQL
// (cf. db/migrations/2026-05-29_occupant_types_extended.sql).
const ALLOWED_TYPE_OCCUPANT = new Set([
  'occupant', 'proprietaire', 'locataire', 'concierge',
  'voisin', 'gestionnaire', 'parties_communes', 'autre',
]);

function sanitize(b: OccupantPatch): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const fields: (keyof OccupantPatch)[] = ['appartement', 'etage', 'prenom', 'nom', 'email', 'telephone', 'instructions'];
  for (const k of fields) {
    if (typeof b[k] === 'string') {
      const v = (b[k] as string).trim();
      out[k] = v || null;
    }
  }
  if (typeof b.contact_preference === 'string' && ALLOWED_PREF.has(b.contact_preference)) {
    out.contact_preference = b.contact_preference;
  }
  if (typeof b.type_occupant === 'string' && ALLOWED_TYPE_OCCUPANT.has(b.type_occupant)) {
    out.type_occupant = b.type_occupant;
  }
  return out;
}

// PATCH — édition partielle d'un occupant
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ occupant_id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { occupant_id } = await params;

  let body: OccupantPatch;
  try {
    body = (await request.json()) as OccupantPatch;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }
  const fields = sanitize(body);
  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ ok: true, no_changes: true });
  }
  const { error } = await supabase
    .from('occupants')
    .update(fields)
    .eq('id', occupant_id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE — suppression d'un occupant
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ occupant_id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { occupant_id } = await params;
  const { error } = await supabase
    .from('occupants')
    .delete()
    .eq('id', occupant_id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
