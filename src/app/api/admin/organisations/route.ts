import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

const ALLOWED_TYPES = new Set(['syndic', 'courtier']);

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  let q = supabase
    .from('organisations')
    .select('id, nom, type, email, contact, telephone, bce, adresse, email_factures, email_rapports, email_communications, created_at')
    .order('nom', { ascending: true });
  if (type && ALLOWED_TYPES.has(type)) q = q.eq('type', type);
  const { data, error } = await q;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, organisations: data ?? [] });
}

interface CreateBody {
  type?: unknown;
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

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }

  const type = typeof body.type === 'string' && ALLOWED_TYPES.has(body.type) ? body.type : '';
  const nom = typeof body.nom === 'string' ? body.nom.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!type) return NextResponse.json({ ok: false, error: 'Type invalide (syndic|courtier).' }, { status: 400 });
  if (!nom) return NextResponse.json({ ok: false, error: 'Nom requis.' }, { status: 400 });
  if (!email || !email.includes('@')) return NextResponse.json({ ok: false, error: 'Email valide requis.' }, { status: 400 });

  const insert: Record<string, string | null> = {
    type, nom, email,
    contact: typeof body.contact === 'string' ? body.contact.trim() || null : null,
    telephone: typeof body.telephone === 'string' ? body.telephone.trim() || null : null,
    bce: typeof body.bce === 'string' ? body.bce.trim() || null : null,
    adresse: typeof body.adresse === 'string' ? body.adresse.trim() || null : null,
    email_factures: typeof body.email_factures === 'string' ? body.email_factures.trim().toLowerCase() || null : null,
    email_rapports: typeof body.email_rapports === 'string' ? body.email_rapports.trim().toLowerCase() || null : null,
    email_communications: typeof body.email_communications === 'string' ? body.email_communications.trim().toLowerCase() || null : null,
  };

  const { data, error } = await supabase
    .from('organisations')
    .insert(insert)
    .select('*')
    .single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, organisation: data });
}
