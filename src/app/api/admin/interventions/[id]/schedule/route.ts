import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from "@/lib/auth/server";
import { brusselsWallTimeToIso } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface PatchBody {
  date?: unknown;             // YYYY-MM-DD
  heure?: unknown;            // HH:MM
  creneau_id?: unknown;       // optionnel — si fourni, le créneau passe en 'reserve'
}

// PATCH /api/admin/interventions/[id]/schedule
// Met à jour creneau_debut + statut → 'attente' (en attente de
// confirmation occupants/client). Si creneau_id fourni, réserve ce créneau
// pour l'intervention (uniquement s'il est libre) ; dans tous les cas, les
// autres créneaux encore réservés pour ce dossier sont libérés.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
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

  // Heure belge → instant UTC exact (heure d'été / d'hiver gérée).
  const creneauDebutIso = brusselsWallTimeToIso(date, heure);

  // 1. Créneau fourni : on le réserve D'ABORD, et seulement s'il est encore
  //    libre (filtre statut='libre' = réservation atomique). S'il est déjà
  //    réservé pour CE dossier, on continue ; pour un autre dossier → 409,
  //    sans toucher à l'intervention.
  let lockedNow = false;
  if (creneauId) {
    const { data: locked, error: cErr } = await supabase
      .from('creneaux_disponibles')
      .update({ intervention_id: id, statut: 'reserve' })
      .eq('id', creneauId)
      .eq('statut', 'libre')
      .select('id');
    if (cErr) return NextResponse.json({ ok: false, error: cErr.message }, { status: 500 });
    lockedNow = Boolean(locked && locked.length > 0);
    if (!lockedNow) {
      const { data: cur } = await supabase
        .from('creneaux_disponibles')
        .select('statut, intervention_id')
        .eq('id', creneauId)
        .maybeSingle();
      const dejaPourCeDossier = cur?.statut === 'reserve' && cur?.intervention_id === id;
      if (!dejaPourCeDossier) {
        return NextResponse.json(
          { ok: false, error: 'Ce créneau n\'est plus libre — choisis-en un autre.' },
          { status: 409 },
        );
      }
    }
  }

  // 2. Planifie l'intervention.
  const { error } = await supabase
    .from('interventions')
    .update({
      creneau_debut: creneauDebutIso,
      statut: 'attente',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) {
    // Rend le créneau qu'on vient de prendre : pas de réservation sans dossier planifié.
    if (creneauId && lockedNow) {
      await supabase
        .from('creneaux_disponibles')
        .update({ statut: 'libre', intervention_id: null })
        .eq('id', creneauId);
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // 3. Replanification : libère les AUTRES créneaux encore réservés pour ce
  //    dossier (sinon l'ancien créneau restait bloqué indéfiniment).
  {
    let release = supabase
      .from('creneaux_disponibles')
      .update({ statut: 'libre', intervention_id: null })
      .eq('intervention_id', id)
      .eq('statut', 'reserve');
    if (creneauId) release = release.neq('id', creneauId);
    const { error: relErr } = await release;
    if (relErr) console.warn('[schedule] libération ancien créneau échouée:', relErr.message);
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
  if (!user || !(await isAdminUser())) {
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
