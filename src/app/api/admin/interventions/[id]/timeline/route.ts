import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

// Journal d'événements (intervention_timeline) d'une intervention — lecture seule.
// Alimente l'onglet « Journal » du drawer admin. Distinct de la route /historique
// (qui renvoie la récidive : autres interventions par appartement/ACP sur 12 mois).
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

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('intervention_timeline')
    .select('id, type, message, payload, created_at, created_by')
    .eq('intervention_id', id)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, events: data ?? [] });
}
