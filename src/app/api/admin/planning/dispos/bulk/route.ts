import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface BulkBody {
  technicien_id?: unknown;
  slots?: unknown;       // [{ day: 0..6 (Lun=0), hour: 8..17 }]
  weeks?: unknown;       // 1 | 2 | 4 | 8
}

interface SlotInput {
  day: number;     // 0=Lundi, 6=Dimanche
  hour: number;    // 8..17 (créneaux d'1h)
}

const ALLOWED_WEEKS = new Set([1, 2, 4, 8]);

function startOfMondayThisWeek(): Date {
  const now = new Date();
  const dow = now.getDay();      // 0=Sun, 1=Mon, ..., 6=Sat
  // Décalage vers Lundi : si dim → -6, sinon → 1-dow
  const offset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(now);
  monday.setDate(now.getDate() + offset);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function hh(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
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

  if (!techId) return NextResponse.json({ ok: false, error: 'technicien_id requis.' }, { status: 400 });

  const slots: SlotInput[] = [];
  for (const s of rawSlots) {
    if (!s || typeof s !== 'object') continue;
    const r = s as Record<string, unknown>;
    const day = typeof r.day === 'number' ? r.day : -1;
    const hour = typeof r.hour === 'number' ? r.hour : -1;
    if (day < 0 || day > 6) continue;
    if (hour < 8 || hour > 17) continue;
    slots.push({ day, hour });
  }
  if (slots.length === 0) {
    return NextResponse.json({ ok: false, error: 'Aucun slot valide.' }, { status: 400 });
  }

  // Génère les rows pour chaque semaine demandée
  const monday = startOfMondayThisWeek();
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
      const d = new Date(monday);
      d.setDate(monday.getDate() + w * 7 + s.day);
      d.setHours(s.hour, 0, 0, 0);
      // Skip dates passées (heure du créneau < maintenant)
      if (d.getTime() < todayMs) {
        skippedPast++;
        continue;
      }
      rows.push({
        technicien_id: techId,
        date: isoDate(d),
        heure_debut: hh(s.hour),
        heure_fin: hh(s.hour + 1),
        statut: 'libre',
      });
    }
  }

  if (rows.length === 0) {
    return NextResponse.json({
      ok: true, created: 0, skipped: skippedPast, skipped_existing: 0,
      message: 'Tous les créneaux générés sont passés — rien à insérer.',
    });
  }

  // Insert avec dédup applicative (Postgres UNIQUE n'est pas posé sur
  // la combinaison tech+date+heure, donc on filtre côté serveur).
  const dates = Array.from(new Set(rows.map((r) => r.date)));
  const { data: existing } = await supabase
    .from('creneaux_disponibles')
    .select('technicien_id, date, heure_debut')
    .eq('technicien_id', techId)
    .in('date', dates);
  const existingKeys = new Set(
    ((existing ?? []) as { technicien_id: string; date: string; heure_debut: string }[])
      .map((e) => `${e.date}|${e.heure_debut}`),
  );
  const filtered = rows.filter((r) => !existingKeys.has(`${r.date}|${r.heure_debut}`));
  const skippedExisting = rows.length - filtered.length;

  if (filtered.length === 0) {
    return NextResponse.json({
      ok: true, created: 0, skipped: skippedPast, skipped_existing: skippedExisting,
    });
  }

  const { error: insErr } = await supabase
    .from('creneaux_disponibles')
    .insert(filtered);
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

  return NextResponse.json({
    ok: true,
    created: filtered.length,
    skipped: skippedPast,
    skipped_existing: skippedExisting,
  });
}
