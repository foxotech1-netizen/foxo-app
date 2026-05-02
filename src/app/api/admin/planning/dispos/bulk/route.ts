import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { roleForEmail } from '@/lib/auth/roles';
import { FOXO_SLOTS, FOXO_DAYS, dayNameToIdx } from '@/lib/foxo-slots';
import { createSlotEvent, deleteCalendarEvent } from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface SlotInput {
  day?: unknown;            // 'lundi'..'dimanche' (ou index 0..6 toléré)
  heure_debut?: unknown;    // 'HH:MM'
  heure_fin?: unknown;      // 'HH:MM'
}

interface BulkBody {
  technicien_id?: unknown;
  slots?: unknown;
  weeks?: unknown;          // 1 | 2 | 4 | 8
  start_date?: unknown;     // 'YYYY-MM-DD' — lundi de la 1re semaine. Optionnel : défaut = lundi de la semaine en cours.
}

const ALLOWED_WEEKS = new Set([1, 2, 4, 8]);

// Vérifie qu'un (heure_debut, heure_fin) correspond bien à un créneau
// FoxO valide. Refuse les heures arbitraires.
function isValidFoxoSlot(hd: string, hf: string): boolean {
  return FOXO_SLOTS.some((s) => s.heure_debut === hd && s.heure_fin === hf);
}

function startOfMondayThisWeek(): Date {
  const now = new Date();
  const dow = now.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(now);
  monday.setDate(now.getDate() + offset);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseStartDate(input: unknown): Date | null {
  if (typeof input !== 'string') return null;
  const m = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setHours(0, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

  let body: BulkBody;
  try {
    body = (await request.json()) as BulkBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }

  const techId = typeof body.technicien_id === 'string' && body.technicien_id ? body.technicien_id : '';
  const weeks = typeof body.weeks === 'number' && ALLOWED_WEEKS.has(body.weeks) ? body.weeks : 1;
  const rawSlots = Array.isArray(body.slots) ? body.slots : [];
  const startDate = parseStartDate(body.start_date) ?? startOfMondayThisWeek();

  if (!techId) {
    return NextResponse.json({ ok: false, error: 'technicien_id requis.' }, { status: 400 });
  }

  // Parse + valide les slots
  type ParsedSlot = { dayIdx: number; heure_debut: string; heure_fin: string };
  const slots: ParsedSlot[] = [];
  for (const raw of rawSlots) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as SlotInput;

    let dayIdx = -1;
    if (typeof r.day === 'string') {
      dayIdx = dayNameToIdx(r.day.toLowerCase().trim());
    } else if (typeof r.day === 'number') {
      dayIdx = r.day;
    }
    if (dayIdx < 0 || dayIdx > 6) continue;

    const hd = typeof r.heure_debut === 'string' ? r.heure_debut.slice(0, 5) : '';
    const hf = typeof r.heure_fin === 'string' ? r.heure_fin.slice(0, 5) : '';
    if (!hd || !hf) continue;
    if (!isValidFoxoSlot(hd, hf)) continue;

    slots.push({ dayIdx, heure_debut: hd, heure_fin: hf });
  }
  if (slots.length === 0) {
    return NextResponse.json({
      ok: false,
      error: `Aucun slot valide. Slots autorisés : ${FOXO_SLOTS.map((s) => `${s.heure_debut}→${s.heure_fin}`).join(', ')} sur ${FOXO_DAYS.join(', ')}.`,
    }, { status: 400 });
  }

  // Génère les rows pour chaque semaine demandée
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  type Row = {
    technicien_id: string;
    date: string;
    heure_debut: string;
    heure_fin: string;
    statut: 'libre';
  };
  const rows: Row[] = [];
  let skippedPast = 0;

  for (let w = 0; w < weeks; w++) {
    for (const s of slots) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + w * 7 + s.dayIdx);
      const [hh, mm] = s.heure_debut.split(':').map(Number);
      d.setHours(hh, mm, 0, 0);
      if (d.getTime() < todayMs) {
        skippedPast++;
        continue;
      }
      rows.push({
        technicien_id: techId,
        date: isoDate(d),
        heure_debut: s.heure_debut,
        heure_fin: s.heure_fin,
        statut: 'libre',
      });
    }
  }

  if (rows.length === 0) {
    return NextResponse.json({
      ok: true,
      created: 0,
      skipped: skippedPast,
      skipped_existing: 0,
      message: 'Tous les créneaux générés sont passés — rien à insérer.',
    });
  }

  // Dédup applicative (UNIQUE absente sur tech+date+heure)
  const dates = Array.from(new Set(rows.map((r) => r.date)));
  const { data: existing, error: existingErr } = await supabase
    .from('creneaux_disponibles')
    .select('technicien_id, date, heure_debut')
    .eq('technicien_id', techId)
    .in('date', dates);
  if (existingErr) {
    console.error('[dispos/bulk] dedup query error', existingErr);
    return NextResponse.json({ ok: false, error: existingErr.message }, { status: 500 });
  }
  const existingKeys = new Set(
    ((existing ?? []) as { technicien_id: string; date: string; heure_debut: string }[])
      .map((e) => `${e.date}|${e.heure_debut.slice(0, 5)}`),
  );
  const filtered = rows.filter((r) => !existingKeys.has(`${r.date}|${r.heure_debut}`));
  const skippedExisting = rows.length - filtered.length;

  if (filtered.length === 0) {
    return NextResponse.json({
      ok: true, created: 0, skipped: skippedPast, skipped_existing: skippedExisting,
    });
  }

  const { data: inserted, error: insErr } = await supabase
    .from('creneaux_disponibles')
    .insert(filtered)
    .select('id, date, heure_debut, heure_fin');
  if (insErr) {
    console.error('[dispos/bulk] insert error', {
      code: (insErr as { code?: string }).code ?? null,
      message: insErr.message,
      details: (insErr as { details?: string }).details ?? null,
      hint: (insErr as { hint?: string }).hint ?? null,
      row_count: filtered.length,
    });
    return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
  }

  // Sync Google Calendar — best effort, non bloquant. Crée un event
  // "Disponible FoxO" pour chaque créneau et stocke google_event_id pour
  // pouvoir le supprimer ensuite. Si Google n'est pas connecté ou si un
  // appel échoue, on continue silencieusement (l'admin peut resync via
  // POST /api/admin/planning/dispos/resync).
  type InsertedRow = { id: string; date: string; heure_debut: string; heure_fin: string };
  const insertedRows = (inserted ?? []) as InsertedRow[];
  let calendarSynced = 0;
  let calendarFailed = 0;
  if (insertedRows.length > 0) {
    const { data: tech } = await supabase
      .from('utilisateurs')
      .select('prenom, nom, couleur')
      .eq('id', techId)
      .maybeSingle();
    const techName = tech ? [tech.prenom, tech.nom].filter(Boolean).join(' ') : undefined;
    const techHex = (tech as { couleur?: string | null } | null)?.couleur ?? null;
    const admin = createAdminClient();
    for (const slot of insertedRows) {
      try {
        const startIso = new Date(`${slot.date}T${slot.heure_debut}:00`).toISOString();
        const endIso = new Date(`${slot.date}T${slot.heure_fin}:00`).toISOString();
        const r = await createSlotEvent({ startIso, endIso, technicienName: techName, technicienHex: techHex });
        if (r.ok) {
          await admin
            .from('creneaux_disponibles')
            .update({ google_event_id: r.event_id })
            .eq('id', slot.id);
          calendarSynced++;
        } else {
          calendarFailed++;
          console.warn('[dispos/bulk] calendar create failed:', { slot_id: slot.id, error: r.error });
        }
      } catch (e) {
        calendarFailed++;
        console.warn('[dispos/bulk] calendar threw:', e);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    created: filtered.length,
    skipped: skippedPast,
    skipped_existing: skippedExisting,
    ids: insertedRows.map((r) => r.id),
    calendar_synced: calendarSynced,
    calendar_failed: calendarFailed,
  });
}

// DELETE — suppression de créneaux par IDs (utilisé par WeeklyDispoGrid
// quand on décoche une case). Ne supprime QUE les créneaux libres pour
// préserver les réservations. Supprime aussi l'event Google Calendar
// associé si google_event_id présent.
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

  let body: { slot_ids?: unknown };
  try {
    body = await request.json() as { slot_ids?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }
  const ids = Array.isArray(body.slot_ids)
    ? body.slot_ids.filter((s): s is string => typeof s === 'string')
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ ok: false, error: 'slot_ids vide.' }, { status: 400 });
  }

  // Récupère les google_event_id avant suppression, et filtre sur libre
  // pour ne pas exposer une intervention réservée à une suppression
  // accidentelle.
  const { data: rows, error: lookupErr } = await supabase
    .from('creneaux_disponibles')
    .select('id, google_event_id, statut')
    .in('id', ids);
  if (lookupErr) {
    return NextResponse.json({ ok: false, error: lookupErr.message }, { status: 500 });
  }
  type Row = { id: string; google_event_id: string | null; statut: string };
  const allRows = (rows ?? []) as Row[];
  const deletable = allRows.filter((r) => r.statut === 'libre');
  const skippedReserved = allRows.length - deletable.length;
  if (deletable.length === 0) {
    return NextResponse.json({ ok: true, deleted: 0, skipped_reserved: skippedReserved, calendar_deleted: 0 });
  }

  const { error: delErr } = await supabase
    .from('creneaux_disponibles')
    .delete()
    .in('id', deletable.map((r) => r.id))
    .eq('statut', 'libre');
  if (delErr) {
    return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 });
  }

  let calendarDeleted = 0;
  let calendarFailed = 0;
  for (const r of deletable) {
    if (!r.google_event_id) continue;
    try {
      const res = await deleteCalendarEvent(r.google_event_id);
      if (res.ok) calendarDeleted++;
      else { calendarFailed++; console.warn('[dispos/bulk DELETE] calendar delete failed:', res.error); }
    } catch (e) {
      calendarFailed++;
      console.warn('[dispos/bulk DELETE] calendar threw:', e);
    }
  }

  return NextResponse.json({
    ok: true,
    deleted: deletable.length,
    skipped_reserved: skippedReserved,
    calendar_deleted: calendarDeleted,
    calendar_failed: calendarFailed,
  });
}
