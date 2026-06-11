import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentTech, verifyTechOwnsObservation, techError } from '@/lib/auth/tech-helpers';

export const dynamic = 'force-dynamic';

const ALLOWED_TEST_TYPES = new Set([
  'Test colorant',
  'Test de pression',
  'Thermographie',
  'Inspection visuelle',
  'Caméra endoscopique',
  "Capteur d'humidité",
  'Autre',
]);

// ─── PATCH /api/tech/observations/[id] ───────────────────────────────────
//
// Body : { test_type?, etage?, localisation?, notes?, ordre? }
// Met à jour les champs fournis. test_type validé si fourni.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: {
    test_type?: unknown;
    etage?: unknown;
    localisation?: unknown;
    notes?: unknown;
    ordre?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }

  const supabase = await createClient();
  const tech = await getCurrentTech(supabase);
  if (!tech.ok) return techError(tech);
  const owns = await verifyTechOwnsObservation(supabase, tech.tech.id, id);
  if (!owns.ok) return techError(owns);

  const patch: Record<string, unknown> = {};
  if ('test_type' in body) {
    if (typeof body.test_type !== 'string' || !body.test_type.trim()) {
      return NextResponse.json({ ok: false, error: 'test_type vide.' }, { status: 400 });
    }
    const tt = body.test_type.trim();
    if (!ALLOWED_TEST_TYPES.has(tt)) {
      return NextResponse.json(
        { ok: false, error: `test_type invalide (${[...ALLOWED_TEST_TYPES].join(' | ')}).` },
        { status: 400 },
      );
    }
    patch.test_type = tt;
  }
  if ('etage' in body) {
    if (body.etage === null) patch.etage = null;
    else if (typeof body.etage === 'string') patch.etage = body.etage.trim().slice(0, 100) || null;
    else return NextResponse.json({ ok: false, error: 'etage doit être string ou null.' }, { status: 400 });
  }
  if ('localisation' in body) {
    if (body.localisation === null) patch.localisation = null;
    else if (typeof body.localisation === 'string') {
      patch.localisation = body.localisation.trim().slice(0, 200) || null;
    } else {
      return NextResponse.json({ ok: false, error: 'localisation doit être string ou null.' }, { status: 400 });
    }
  }
  if ('notes' in body) {
    if (body.notes === null) patch.notes = null;
    else if (typeof body.notes === 'string') patch.notes = body.notes.trim().slice(0, 5000) || null;
    else return NextResponse.json({ ok: false, error: 'notes doit être string ou null.' }, { status: 400 });
  }
  if ('ordre' in body) {
    if (typeof body.ordre === 'number' && Number.isInteger(body.ordre) && body.ordre >= 0) {
      patch.ordre = body.ordre;
    } else {
      return NextResponse.json({ ok: false, error: 'ordre doit être un entier >= 0.' }, { status: 400 });
    }
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: 'Rien à mettre à jour.' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from('observations_terrain')
    .update(patch)
    .eq('id', id);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// ─── DELETE /api/tech/observations/[id] ──────────────────────────────────
//
// Supprime l'observation. Les photos liées sont d'abord détachées
// (observation_id → null) — la FK ON DELETE SET NULL ferait pareil mais
// on l'explicite côté code pour rester certain du comportement.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await createClient();
  const tech = await getCurrentTech(supabase);
  if (!tech.ok) return techError(tech);
  const owns = await verifyTechOwnsObservation(supabase, tech.tech.id, id);
  if (!owns.ok) return techError(owns);

  const admin = createAdminClient();

  // 1. Détache les photos liées (préservation explicite ; la FK fait
  //    pareil mais on garde le contrôle côté app).
  const { error: detachErr } = await admin
    .from('photos_interventions')
    .update({ observation_id: null })
    .eq('observation_id', id);
  if (detachErr) {
    return NextResponse.json({ ok: false, error: detachErr.message }, { status: 500 });
  }

  // 2. Supprime l'observation.
  const { error: delErr } = await admin
    .from('observations_terrain')
    .delete()
    .eq('id', id);
  if (delErr) {
    return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
