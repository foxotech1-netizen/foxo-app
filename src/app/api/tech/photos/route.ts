import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

// GET /api/tech/photos?intervention_id=X
//
// Retourne toutes les photos de l'intervention (id, drive_url, filename,
// section, ordre, uploaded_at) pour alimenter les zones photos par
// section dans RapportPanel. Vérifie que le tech connecté est bien
// assigné à l'intervention (sinon 403).
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Autorise les techs whitelist (TECH_EMAILS), les admins, et tout
  // utilisateur dont la row utilisateurs porte role = 'technicien'
  // (techs créés en DB sans être hardcodés dans roles.ts).
  const role = roleForEmail(user?.email);
  const isTech = role === 'tech' || role === 'admin';
  const isTechDB = user
    ? await supabase
        .from('utilisateurs')
        .select('id')
        .eq('email', (user.email ?? '').toLowerCase())
        .eq('role', 'technicien')
        .maybeSingle()
        .then((r) => !!r.data)
    : false;
  if (!user || (!isTech && !isTechDB)) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

  const url = new URL(request.url);
  const interventionId = url.searchParams.get('intervention_id');
  if (!interventionId) {
    return NextResponse.json({ ok: false, error: 'intervention_id requis.' }, { status: 400 });
  }

  // Ownership check — le tech doit être assigné à cette intervention.
  const { data: techRow } = await supabase
    .from('utilisateurs')
    .select('id')
    .eq('email', (user.email ?? '').toLowerCase())
    .maybeSingle();
  if (!techRow) return NextResponse.json({ ok: false, error: 'Tech inconnu.' }, { status: 403 });

  const { data: iv } = await supabase
    .from('interventions')
    .select('technicien_id')
    .eq('id', interventionId)
    .maybeSingle();
  if (!iv || iv.technicien_id !== techRow.id) {
    return NextResponse.json({ ok: false, error: 'Intervention non assignée.' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('photos_interventions')
    .select('id, drive_url, filename, section, ordre, uploaded_at, label, observation_id')
    .eq('intervention_id', interventionId)
    .order('section', { ascending: true, nullsFirst: false })
    .order('ordre', { ascending: true })
    .order('uploaded_at', { ascending: false });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, photos: data ?? [] });
}
