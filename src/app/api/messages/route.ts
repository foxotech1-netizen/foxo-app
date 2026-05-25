import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from "@/lib/auth/server";
import { getCurrentSyndic } from '@/lib/portal/syndic';

export const dynamic = 'force-dynamic';

// Détermine qui est l'utilisateur connecté (admin ou partenaire) et son
// auteur_type pour les inserts. Les RLS de la migration 2026-05-27 gèrent
// le périmètre (admin_all_messages, syndic_owns_intervention) — cette
// fonction ne fait que résoudre l'identité.
async function resolveCaller(): Promise<
  | { ok: true; isAdmin: true; email: string }
  | { ok: true; isAdmin: false; email: string; orgType: 'syndic' | 'courtier' }
  | { ok: false; error: string; status: number }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, error: 'Non connecté.', status: 401 };

  if (await isAdminUser()) {
    return { ok: true, isAdmin: true, email: user.email };
  }

  const session = await getCurrentSyndic();
  if (!session?.org) {
    return { ok: false, error: 'Compte non lié à un partenaire.', status: 403 };
  }
  const orgType: 'syndic' | 'courtier' = session.org.type === 'courtier' ? 'courtier' : 'syndic';
  return { ok: true, isAdmin: false, email: user.email, orgType };
}

// ─── GET — liste des messages d'une intervention ──────────────────────
//
// Le query param ?intervention_id=X est obligatoire. Les RLS filtrent :
// admin voit tout, syndic/courtier ne voit que les interventions de son
// organisation (helper SECURITY DEFINER syndic_owns_intervention).
export async function GET(request: Request) {
  const caller = await resolveCaller();
  if (!caller.ok) return NextResponse.json({ ok: false, error: caller.error }, { status: caller.status });

  const url = new URL(request.url);
  const interventionId = url.searchParams.get('intervention_id');
  if (!interventionId) {
    return NextResponse.json({ ok: false, error: 'intervention_id requis.' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('messages')
    .select('id, intervention_id, auteur_type, auteur_email, contenu, created_at, lu_admin, lu_syndic')
    .eq('intervention_id', interventionId)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, messages: data ?? [] });
}

// ─── POST — création d'un message ─────────────────────────────────────
//
// Body : { intervention_id, contenu }. auteur_type et auteur_email sont
// dérivés de la session (impossible de spoofer). Les RLS valident
// l'accès à l'intervention (admin_all_messages ou syndic_insert_messages
// avec check `auteur_email = auth.email()`).
export async function POST(request: Request) {
  const caller = await resolveCaller();
  if (!caller.ok) return NextResponse.json({ ok: false, error: caller.error }, { status: caller.status });

  let body: { intervention_id?: unknown; contenu?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }

  const interventionId = typeof body.intervention_id === 'string' ? body.intervention_id : '';
  const contenu = typeof body.contenu === 'string' ? body.contenu.trim() : '';
  if (!interventionId) return NextResponse.json({ ok: false, error: 'intervention_id requis.' }, { status: 400 });
  if (!contenu) return NextResponse.json({ ok: false, error: 'Message vide.' }, { status: 400 });

  const auteurType = caller.isAdmin ? 'admin' : caller.orgType;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('messages')
    .insert({
      intervention_id: interventionId,
      auteur_type: auteurType,
      auteur_email: caller.email,
      contenu,
    })
    .select('id, intervention_id, auteur_type, auteur_email, contenu, created_at, lu_admin, lu_syndic')
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, message: data });
}
