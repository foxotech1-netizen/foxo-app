import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

interface OccupantInput {
  appartement?: unknown;
  etage?: unknown;
  prenom?: unknown;
  nom?: unknown;
  email?: unknown;
  telephone?: unknown;
  instructions?: unknown;
  contact_preference?: unknown;
}

const ALLOWED_PREF = new Set(['email', 'sms', 'whatsapp', 'both']);

function sanitize(b: OccupantInput): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const fields: (keyof OccupantInput)[] = ['appartement', 'etage', 'prenom', 'nom', 'email', 'telephone', 'instructions'];
  for (const k of fields) {
    if (typeof b[k] === 'string') {
      const v = (b[k] as string).trim();
      out[k] = v || null;
    }
  }
  if (typeof b.contact_preference === 'string' && ALLOWED_PREF.has(b.contact_preference)) {
    out.contact_preference = b.contact_preference;
  }
  return out;
}

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

  // SELECT complet (avec les colonnes ajoutées par la migration
  // 2026-05-11_occupants_token.sql).
  const { data, error } = await supabase
    .from('occupants')
    .select('id, appartement, etage, prenom, nom, email, telephone, instructions, conf, contact_preference, token_sent_at, confirmation_token')
    .eq('intervention_id', id)
    .order('appartement', { ascending: true });

  if (!error) {
    return NextResponse.json({ ok: true, occupants: data ?? [] });
  }

  // Log détaillé — apparaît dans Vercel runtime logs
  console.error('[occupants GET] supabase error', {
    intervention_id: id,
    code: (error as { code?: string }).code ?? null,
    message: error.message,
    details: (error as { details?: string }).details ?? null,
    hint: (error as { hint?: string }).hint ?? null,
  });

  // Fallback : si l'erreur est "column does not exist" (code 42703),
  // la migration 2026-05-11_occupants_token.sql n'est probablement
  // pas appliquée. On retombe sur le SELECT legacy pour ne pas casser
  // le drawer.
  const code = (error as { code?: string }).code;
  if (code === '42703' || /column .* does not exist/i.test(error.message)) {
    console.warn('[occupants GET] fallback to legacy columns — apply migration 2026-05-11_occupants_token.sql');
    const { data: legacyData, error: legacyErr } = await supabase
      .from('occupants')
      .select('id, appartement, etage, prenom, nom, email, telephone, instructions, conf, contact_preference')
      .eq('intervention_id', id)
      .order('appartement', { ascending: true });
    if (legacyErr) {
      console.error('[occupants GET] legacy fallback failed too', legacyErr);
      return NextResponse.json({ ok: false, error: legacyErr.message }, { status: 500 });
    }
    // Renvoie les colonnes manquantes en null pour rester compatible
    // avec le DrawerOccupant côté client.
    const padded = (legacyData ?? []).map((o) => ({
      ...o,
      token_sent_at: null,
      confirmation_token: null,
    }));
    return NextResponse.json({
      ok: true,
      occupants: padded,
      _warning: 'migration_2026-05-11_pending',
    });
  }

  return NextResponse.json({ ok: false, error: error.message, code: code ?? null }, { status: 500 });
}

// POST — créer un occupant pour cette intervention
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

  let body: OccupantInput;
  try {
    body = (await request.json()) as OccupantInput;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }
  const fields = sanitize(body);
  const { data, error } = await supabase
    .from('occupants')
    .insert({ ...fields, intervention_id: id, conf: 'en_attente' })
    .select('id')
    .single();
  if (error) {
    console.error('[occupants POST] supabase error', {
      intervention_id: id,
      code: (error as { code?: string }).code ?? null,
      message: error.message,
      details: (error as { details?: string }).details ?? null,
      hint: (error as { hint?: string }).hint ?? null,
    });
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: data?.id });
}
