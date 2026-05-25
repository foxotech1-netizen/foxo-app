import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from "@/lib/auth/server";

export const dynamic = 'force-dynamic';

// GET /api/admin/planning/dispos?technicien_id=X&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
// Renvoie les créneaux d'un technicien dans une fenêtre. Utilisé par
// WeeklyDispoGrid pour pré-cocher les cases existantes en DB.
//
// On retourne TOUS les statuts (libre/reserve/bloque) — la grille les
// affiche en lecture seule pour les non-libre (impossible de décocher
// une réservation depuis la grille de dispos par sécurité).
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const techId = searchParams.get('technicien_id');
  const start = searchParams.get('start_date');
  const end = searchParams.get('end_date');
  if (!techId || !start || !end) {
    return NextResponse.json({ ok: false, error: 'Paramètres requis : technicien_id, start_date, end_date.' }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return NextResponse.json({ ok: false, error: 'Format date invalide (YYYY-MM-DD attendu).' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('creneaux_disponibles')
    .select('id, date, heure_debut, heure_fin, statut, google_event_id')
    .eq('technicien_id', techId)
    .gte('date', start)
    .lte('date', end)
    .order('date', { ascending: true })
    .order('heure_debut', { ascending: true });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, slots: data ?? [] });
}
