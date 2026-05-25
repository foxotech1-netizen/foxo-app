import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from "@/lib/auth/server";

export const dynamic = 'force-dynamic';

// GET /api/admin/acps/[id] — fetch minimal (id, nom, adresse, ville).
// Utilisé par le bandeau "ACP suggérée" du drawer pour afficher le nom
// de l'ACP candidate à partir de son id (la suggestion stockée en DB
// ne contient que id + nom_extrait + score).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { id } = await params;
  const { data, error } = await supabase
    .from('acps')
    .select('id, nom, adresse, code_postal, ville')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: 'ACP introuvable.' }, { status: 404 });
  return NextResponse.json({ ok: true, acp: data });
}
