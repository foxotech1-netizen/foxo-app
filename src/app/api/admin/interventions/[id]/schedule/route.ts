import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

interface PatchBody {
  date?: unknown;             // YYYY-MM-DD
  heure?: unknown;            // HH:MM
  creneau_id?: unknown;       // optionnel — si fourni, le créneau passe en 'reserve'
}

// PATCH /api/admin/interventions/[id]/schedule
// Met à jour creneau_debut + statut → 'attente' (en attente de
// confirmation occupants/client). Si creneau_id fourni, lie aussi
// le creneau à l'intervention et le marque réservé.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { id } = await params;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }

  const date = typeof body.date === 'string' ? body.date : '';
  const heure = typeof body.heure === 'string' ? body.heure : '';
  const creneauId = typeof body.creneau_id === 'string' && body.creneau_id ? body.creneau_id : null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ ok: false, error: 'Date invalide (YYYY-MM-DD).' }, { status: 400 });
  }
  if (!/^\d{2}:\d{2}$/.test(heure)) {
    return NextResponse.json({ ok: false, error: 'Heure invalide (HH:MM).' }, { status: 400 });
  }

  const creneauDebutIso = new Date(`${date}T${heure}:00`).toISOString();

  const { error } = await supabase
    .from('interventions')
    .update({
      creneau_debut: creneauDebutIso,
      statut: 'attente',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Lie le créneau si fourni
  if (creneauId) {
    const { error: cErr } = await supabase
      .from('creneaux_disponibles')
      .update({ intervention_id: id, statut: 'reserve' })
      .eq('id', creneauId);
    if (cErr) {
      console.warn('[schedule] creneau update failed:', cErr.message);
      // On ne fail pas — l'intervention est déjà planifiée.
    }
  }

  return NextResponse.json({ ok: true, creneau_debut: creneauDebutIso });
}

// GET /api/admin/interventions/[id]/schedule?tech={technicien_id}&from=YYYY-MM-DD
// Renvoie les créneaux libres du technicien sur 30 jours pour
// alimenter le date picker.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  await params;     // route param non utilisé ici mais requis par signature

  const url = new URL(request.url);
  const techId = url.searchParams.get('tech');
  const today = new Date();
  const fromStr = url.searchParams.get('from')
    ?? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const toDate = new Date(today);
  toDate.setDate(toDate.getDate() + 30);
  const toStr = `${toDate.getFullYear()}-${String(toDate.getMonth() + 1).padStart(2, '0')}-${String(toDate.getDate()).padStart(2, '0')}`;

  let q = supabase
    .from('creneaux_disponibles')
    .select('id, technicien_id, date, heure_debut, heure_fin, statut')
    .eq('statut', 'libre')
    .gte('date', fromStr)
    .lte('date', toStr)
    .order('date', { ascending: true })
    .order('heure_debut', { ascending: true });
  if (techId) q = q.eq('technicien_id', techId);

  const { data, error } = await q;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, creneaux: data ?? [] });
}
