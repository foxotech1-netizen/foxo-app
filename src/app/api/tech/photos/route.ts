import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getCurrentTech, verifyTechOwnsIntervention, techError } from '@/lib/auth/tech-helpers';

export const dynamic = 'force-dynamic';

// GET /api/tech/photos?intervention_id=X
//
// Retourne toutes les photos de l'intervention (id, drive_url, filename,
// section, ordre, uploaded_at) pour alimenter les zones photos par
// section dans RapportPanel. Vérifie que le tech connecté est bien
// assigné à l'intervention (sinon 403).
export async function GET(request: Request) {
  const supabase = await createClient();
  const tech = await getCurrentTech(supabase);
  if (!tech.ok) return techError(tech);

  const url = new URL(request.url);
  const interventionId = url.searchParams.get('intervention_id');
  if (!interventionId) {
    return NextResponse.json({ ok: false, error: 'intervention_id requis.' }, { status: 400 });
  }

  // Ownership check — le tech doit être assigné à cette intervention.
  const owns = await verifyTechOwnsIntervention(supabase, tech.tech.id, interventionId);
  if (!owns.ok) return techError(owns);

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
