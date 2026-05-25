import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from "@/lib/auth/server";
import { createSlotEvent } from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/admin/planning/dispos/resync
// Trouve tous les créneaux libres SANS google_event_id (futur ou
// présent) et crée l'event Calendar manquant. Utile quand :
//   - Google a été connecté APRÈS la création de créneaux
//   - Une vague de créations a partiellement échoué côté Calendar
//   - L'admin veut forcer un re-sync après debug
//
// Limite à 100 créneaux par run pour rester sous maxDuration=60s.
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // Charge les créneaux à resync — uniquement libre + futur, dans la limite.
  const { data: slots, error } = await supabase
    .from('creneaux_disponibles')
    .select('id, technicien_id, date, heure_debut, heure_fin')
    .is('google_event_id', null)
    .eq('statut', 'libre')
    .gte('date', todayIso)
    .order('date', { ascending: true })
    .limit(100);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  type Row = { id: string; technicien_id: string | null; date: string; heure_debut: string; heure_fin: string };
  const rows = (slots ?? []) as Row[];

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, total: 0, synced: 0, failed: 0, message: 'Aucun créneau à resynchroniser — tout est à jour.' });
  }

  // Charge tous les techs concernés en une fois pour les noms d'events
  const techIds = Array.from(new Set(rows.map((r) => r.technicien_id).filter((x): x is string => Boolean(x))));
  const techNameById = new Map<string, string>();
  const techHexById = new Map<string, string | null>();
  if (techIds.length > 0) {
    const { data: techs } = await supabase
      .from('utilisateurs')
      .select('id, prenom, nom, couleur')
      .in('id', techIds);
    for (const t of (techs ?? []) as { id: string; prenom: string | null; nom: string | null; couleur: string | null }[]) {
      techNameById.set(t.id, [t.prenom, t.nom].filter(Boolean).join(' '));
      techHexById.set(t.id, t.couleur ?? null);
    }
  }

  const admin = createAdminClient();
  let synced = 0;
  let failed = 0;
  const failures: { slot_id: string; error: string }[] = [];
  for (const slot of rows) {
    try {
      const startIso = new Date(`${slot.date}T${slot.heure_debut}:00`).toISOString();
      const endIso = new Date(`${slot.date}T${slot.heure_fin}:00`).toISOString();
      const techName = slot.technicien_id ? techNameById.get(slot.technicien_id) : undefined;
      const techHex = slot.technicien_id ? techHexById.get(slot.technicien_id) ?? null : null;
      const r = await createSlotEvent({ startIso, endIso, technicienName: techName, technicienHex: techHex });
      if (r.ok) {
        await admin
          .from('creneaux_disponibles')
          .update({ google_event_id: r.event_id })
          .eq('id', slot.id);
        synced++;
      } else {
        failed++;
        failures.push({ slot_id: slot.id, error: r.error });
        // Si Google n'est pas connecté, inutile de continuer la boucle
        if (/non connecté/i.test(r.error)) {
          return NextResponse.json({
            ok: false,
            error: 'Google Calendar non connecté. Connecte-le dans Paramètres avant de resynchroniser.',
            total: rows.length,
            synced,
            failed: rows.length - synced,
          }, { status: 400 });
        }
      }
    } catch (e) {
      failed++;
      failures.push({ slot_id: slot.id, error: e instanceof Error ? e.message : 'Erreur inconnue' });
    }
  }

  return NextResponse.json({
    ok: true,
    total: rows.length,
    synced,
    failed,
    failures: failed > 0 ? failures.slice(0, 20) : undefined,
    truncated: rows.length === 100,
  });
}
