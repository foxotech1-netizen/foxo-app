import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentTech, verifyTechOwnsIntervention, techError } from '@/lib/auth/tech-helpers';

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

// ─── GET /api/tech/observations?intervention_id=X ────────────────────────
//
// Retourne les observations de l'intervention triées par ordre puis date,
// chacune avec ses photos liées (photos_interventions.observation_id).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const interventionId = url.searchParams.get('intervention_id');
  if (!interventionId) {
    return NextResponse.json({ ok: false, error: 'intervention_id requis.' }, { status: 400 });
  }

  const supabase = await createClient();
  const tech = await getCurrentTech(supabase);
  if (!tech.ok) return techError(tech);
  const owns = await verifyTechOwnsIntervention(supabase, tech.tech.id, interventionId);
  if (!owns.ok) return techError(owns);

  // Service-role : RLS observations_terrain pas encore définie dans le
  // schéma — on bypass pour rester cohérent avec les autres routes.
  const admin = createAdminClient();

  const { data: obs, error } = await admin
    .from('observations_terrain')
    .select('id, test_type, etage, localisation, notes, ordre, created_at')
    .eq('intervention_id', interventionId)
    .order('ordre', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!obs || obs.length === 0) {
    return NextResponse.json({ ok: true, observations: [] });
  }

  // 2e query : photos liées à ces observations (1 round-trip pour toutes
  // les obs, pas de N+1).
  const obsIds = obs.map((o) => o.id as string);
  const { data: photos } = await admin
    .from('photos_interventions')
    .select('id, drive_url, filename, ordre, label, observation_id')
    .in('observation_id', obsIds)
    .order('ordre', { ascending: true });

  const photosByObs = new Map<string, unknown[]>();
  for (const p of photos ?? []) {
    const obsId = p.observation_id as string | null;
    if (!obsId) continue;
    const list = photosByObs.get(obsId) ?? [];
    list.push(p);
    photosByObs.set(obsId, list);
  }

  const observations = obs.map((o) => ({
    ...o,
    photos: photosByObs.get(o.id as string) ?? [],
  }));

  return NextResponse.json({ ok: true, observations });
}

// ─── POST /api/tech/observations ─────────────────────────────────────────
//
// Body : { intervention_id, test_type, etage?, localisation?, notes? }
// Crée une observation. test_type est validé contre la liste autorisée.
export async function POST(request: Request) {
  let body: {
    intervention_id?: unknown;
    test_type?: unknown;
    etage?: unknown;
    localisation?: unknown;
    notes?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }

  const interventionId = typeof body.intervention_id === 'string' ? body.intervention_id : null;
  if (!interventionId) {
    return NextResponse.json({ ok: false, error: 'intervention_id requis.' }, { status: 400 });
  }

  const testType = typeof body.test_type === 'string' ? body.test_type.trim() : '';
  if (!testType) {
    return NextResponse.json({ ok: false, error: 'test_type requis.' }, { status: 400 });
  }
  if (!ALLOWED_TEST_TYPES.has(testType)) {
    return NextResponse.json(
      { ok: false, error: `test_type invalide (${[...ALLOWED_TEST_TYPES].join(' | ')}).` },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const tech = await getCurrentTech(supabase);
  if (!tech.ok) return techError(tech);
  const owns = await verifyTechOwnsIntervention(supabase, tech.tech.id, interventionId);
  if (!owns.ok) return techError(owns);

  const etage = typeof body.etage === 'string' ? body.etage.trim().slice(0, 100) || null : null;
  const localisation = typeof body.localisation === 'string'
    ? body.localisation.trim().slice(0, 200) || null
    : null;
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 5000) || null : null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('observations_terrain')
    .insert({
      intervention_id: interventionId,
      test_type: testType,
      etage,
      localisation,
      notes,
    })
    .select('id, test_type, etage, localisation, notes, ordre, created_at')
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, observation: data });
}
