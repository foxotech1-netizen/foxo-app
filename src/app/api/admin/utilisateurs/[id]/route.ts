import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { roleForEmail } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

async function assertAdmin(): Promise<NextResponse | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  return null;
}

async function notifyPgrstReload(admin: ReturnType<typeof createAdminClient>): Promise<void> {
  try {
    await admin.rpc('notify_pgrst_reload');
  } catch (e) {
    console.warn('[utilisateurs] NOTIFY pgrst skipped:', e instanceof Error ? e.message : e);
  }
}

// ─── PATCH — toggle actif ─────────────────────────────────────────────
//
// N'accepte que { actif: boolean } pour rester cohérent avec le brief.
// Si on veut éditer email/role/organisation_id plus tard, étendre ici
// avec un sanitize() comme dans /api/admin/syndics/[org_id]/route.ts.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await assertAdmin();
  if (guard) return guard;

  const { id } = await params;

  let body: { actif?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }

  if (typeof body.actif !== 'boolean') {
    return NextResponse.json(
      { ok: false, error: 'Champ "actif" booléen requis.' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('utilisateurs')
    .update({ actif: body.actif })
    .eq('id', id)
    .select(`
      id, email, role, actif, organisation_id, telephone,
      created_at, last_seen_at,
      organisation:organisations(id, nom)
    `)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: 'Utilisateur introuvable.' }, { status: 404 });
  }

  await notifyPgrstReload(admin);

  // Déballe l'array/object retourné par la jointure Supabase (cf. GET).
  const orgRaw = (data as unknown as { organisation: { nom: string }[] | { nom: string } | null }).organisation;
  const org = Array.isArray(orgRaw) ? (orgRaw[0] ?? null) : orgRaw;
  const utilisateur = {
    ...data,
    organisation: org,
    org_nom: org?.nom ?? null,
  };
  return NextResponse.json({ ok: true, utilisateur });
}

// ─── DELETE — hard delete public.utilisateurs ─────────────────────────
//
// Hard delete intentionnel ici (l'utilisateur peut être recréé via POST
// si l'auth.users existe toujours). Pour un soft delete, utiliser PATCH
// { actif: false } qui bloque déjà l'accès au login (cf. whitelist DB
// dans src/app/auth/login/actions.ts).
//
// Ne touche PAS auth.users — l'admin doit le supprimer séparément via le
// dashboard Supabase si nécessaire (sinon la personne peut toujours se
// connecter mais sera bloquée par la whitelist).
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await assertAdmin();
  if (guard) return guard;

  const { id } = await params;

  const admin = createAdminClient();
  const { error } = await admin.from('utilisateurs').delete().eq('id', id);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  await notifyPgrstReload(admin);

  return NextResponse.json({ ok: true });
}
