import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentTech, techError } from '@/lib/auth/tech-helpers';

export const dynamic = 'force-dynamic';

// ─── Helper : auth + double ownership ────────────────────────────────────
//
// Vérifie que :
//   1. L'utilisateur est tech/admin
//   2. L'observation existe et appartient à une intervention dont le
//      tech est assigné
//   3. La photo existe et appartient à la MÊME intervention que
//      l'observation (sinon on permettrait de lier une photo d'une
//      autre intervention, ce qui n'a pas de sens métier)
async function authBothOwnerships(obsId: string, photoId: string) {
  const supabase = await createClient();
  // Auth + résolution du tech (bloc partagé, cf. lib/auth/tech-helpers).
  const tech = await getCurrentTech(supabase);
  if (!tech.ok) return { ok: false as const, response: techError(tech) };

  const admin = createAdminClient();
  const { data: obsRow } = await admin
    .from('observations_terrain')
    .select('intervention_id')
    .eq('id', obsId)
    .maybeSingle();
  if (!obsRow) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: 'Observation introuvable.' }, { status: 404 }),
    };
  }

  const { data: photoRow } = await admin
    .from('photos_interventions')
    .select('intervention_id')
    .eq('id', photoId)
    .maybeSingle();
  if (!photoRow) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: 'Photo introuvable.' }, { status: 404 }),
    };
  }

  if (photoRow.intervention_id !== obsRow.intervention_id) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: 'Photo et observation appartiennent à des interventions différentes.' },
        { status: 400 },
      ),
    };
  }

  const { data: iv } = await supabase
    .from('interventions')
    .select('technicien_id')
    .eq('id', obsRow.intervention_id)
    .maybeSingle();
  if (!iv || iv.technicien_id !== tech.tech.id) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: 'Intervention non assignée.' },
        { status: 403 },
      ),
    };
  }

  return { ok: true as const };
}

// ─── POST /api/tech/observations/[id]/photos ─────────────────────────────
//
// Body : { photo_id }
// Lie une photo existante à cette observation.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: { photo_id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }
  const photoId = typeof body.photo_id === 'string' ? body.photo_id : null;
  if (!photoId) {
    return NextResponse.json({ ok: false, error: 'photo_id requis.' }, { status: 400 });
  }

  const auth = await authBothOwnerships(id, photoId);
  if (!auth.ok) return auth.response;

  const admin = createAdminClient();
  const { error } = await admin
    .from('photos_interventions')
    .update({ observation_id: id })
    .eq('id', photoId);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// ─── DELETE /api/tech/observations/[id]/photos ───────────────────────────
//
// Body : { photo_id }
// Détache la photo de l'observation (observation_id → null). La photo
// reste sur Drive et dans photos_interventions.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: { photo_id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }
  const photoId = typeof body.photo_id === 'string' ? body.photo_id : null;
  if (!photoId) {
    return NextResponse.json({ ok: false, error: 'photo_id requis.' }, { status: 400 });
  }

  const auth = await authBothOwnerships(id, photoId);
  if (!auth.ok) return auth.response;

  const admin = createAdminClient();
  const { error } = await admin
    .from('photos_interventions')
    .update({ observation_id: null })
    .eq('id', photoId);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
