import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from "@/lib/auth/server";

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_ROLES = new Set(['syndic', 'courtier', 'technicien']);

async function assertAdmin(): Promise<NextResponse | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  return null;
}

// Best-effort : demande à PostgREST de recharger son cache de schéma
// (utile après un ALTER TABLE — pas strictement nécessaire pour un CRUD,
// mais conforme au brief). Requiert que la fonction RPC existe en DB
// (cf. note dans la migration 2026-05-28_utilisateurs_organisation_id.sql).
async function notifyPgrstReload(admin: ReturnType<typeof createAdminClient>): Promise<void> {
  try {
    await admin.rpc('notify_pgrst_reload');
  } catch (e) {
    console.warn('[utilisateurs] NOTIFY pgrst skipped:', e instanceof Error ? e.message : e);
  }
}

// ─── GET — liste partenaires + techniciens ─────────────────────────────
//
// Filtre role IN (syndic, courtier, technicien) → exclut les admins
// hardcodés (cf. roles.ts). Join LEFT vers organisations sur la nouvelle
// colonne utilisateurs.organisation_id.
export async function GET() {
  const guard = await assertAdmin();
  if (guard) return guard;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('utilisateurs')
    .select(`
      id, email, role, actif, organisation_id, telephone,
      created_at, last_seen_at,
      organisation:organisations(id, nom)
    `)
    .in('role', ['syndic', 'courtier', 'technicien'])
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Aplatit org_nom au top-level pour rester aligné avec le SQL du brief
  // (LEFT JOIN organisations o ON o.id = u.organisation_id, alias org_nom).
  // Supabase JS type la jointure imbriquée comme array (conservateur sur la
  // cardinalité), même si la FK garantit 0 ou 1 — on déballe ici.
  const utilisateurs = ((data ?? []) as unknown as Array<Record<string, unknown> & {
    organisation: { id: string; nom: string }[] | { id: string; nom: string } | null;
  }>).map((u) => {
    const org = Array.isArray(u.organisation) ? (u.organisation[0] ?? null) : u.organisation;
    return {
      ...u,
      organisation: org,
      org_nom: org?.nom ?? null,
    };
  });

  return NextResponse.json({ ok: true, utilisateurs });
}

// ─── POST — création d'un partenaire ou technicien ─────────────────────
//
// 1. Cherche l'UUID dans auth.users par email (via listUsers car le SDK
//    n'expose pas getUserByEmail — pagination 1000 max, suffisant pour le
//    volume FoxO).
// 2. Si pas trouvé → 404 + code 'no_auth_account' (UI affiche un message
//    expliquant qu'il faut d'abord se connecter sur portal.foxo.be).
// 3. Si trouvé → INSERT public.utilisateurs avec id = uuid auth, role,
//    actif=true, organisation_id (nullable pour technicien interne).
export async function POST(request: Request) {
  const guard = await assertAdmin();
  if (guard) return guard;

  let body: { email?: unknown; role?: unknown; organisation_id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const role = typeof body.role === 'string' ? body.role.trim() : '';
  const organisationId = typeof body.organisation_id === 'string'
    ? body.organisation_id.trim() || null
    : null;

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: 'Email invalide.' }, { status: 400 });
  }
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json(
      { ok: false, error: `Rôle invalide (attendu : syndic, courtier ou technicien).` },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // ── 1. Vérification auth.users via listUsers ──
  const { data: usersData, error: usersErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (usersErr) {
    return NextResponse.json({ ok: false, error: usersErr.message }, { status: 500 });
  }
  const userAuth = usersData?.users.find(
    (u) => (u.email ?? '').toLowerCase() === email,
  );
  if (!userAuth) {
    return NextResponse.json(
      {
        ok: false,
        error: 'no_auth_account',
        message: "Cet email n'a pas encore de compte. Demandez à la personne de se connecter une fois sur portal.foxo.be puis revenez ici.",
      },
      { status: 404 },
    );
  }

  // ── 2. INSERT public.utilisateurs ──
  const { data: inserted, error: insertErr } = await admin
    .from('utilisateurs')
    .insert({
      id: userAuth.id,
      email,
      role,
      actif: true,
      organisation_id: organisationId,
    })
    .select(`
      id, email, role, actif, organisation_id, telephone,
      created_at, last_seen_at,
      organisation:organisations(id, nom)
    `)
    .single();

  if (insertErr) {
    if (insertErr.code === '23505') {
      return NextResponse.json(
        { ok: false, error: 'Cet utilisateur est déjà enregistré.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: false, error: insertErr.message }, { status: 500 });
  }

  await notifyPgrstReload(admin);

  // Aplatit org_nom (cohérence avec GET — cf. déballage array/object).
  const orgRaw = (inserted as unknown as { organisation: { nom: string }[] | { nom: string } | null }).organisation;
  const org = Array.isArray(orgRaw) ? (orgRaw[0] ?? null) : orgRaw;
  const utilisateur = {
    ...inserted,
    organisation: org,
    org_nom: org?.nom ?? null,
  };

  return NextResponse.json({ ok: true, utilisateur });
}
