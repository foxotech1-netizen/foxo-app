// POST /api/admin/calendar/events
// Body : { thread_id: string }
// Response : { success, event_id, event_url }
//
// Confirme le créneau proposé par l'analyse Claude :
//  1. Crée l'event Google Calendar (createCalendarEvent existant)
//  2. Marque creneaux_disponibles.statut = 'reserve' (+ intervention_id).
//     Le créneau est accepté s'il est encore libre OU déjà réservé pour CE
//     dossier (cas normal : confirm-and-create le réserve à la création).
//  3. Met à jour interventions : creneau_debut + technicien_id +
//     statut='confirmee' (option B validée — pas de FK creneau_id sur
//     intervention, on dérive depuis le créneau choisi)
//  4. Persiste event_calendar_id sur mails_analyses

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from "@/lib/auth/server";
import { createCalendarEvent } from '@/lib/google-calendar';
import { brusselsWallTimeToIso } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface CalendarEventBody {
  thread_id?: unknown;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ success: false, error: 'Accès refusé.' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as CalendarEventBody;
  const threadId = typeof body.thread_id === 'string' ? body.thread_id.trim() : '';
  if (!threadId) {
    return NextResponse.json({ success: false, error: 'thread_id requis.' }, { status: 400 });
  }

  const admin = createAdminClient();

  // 1. Récup analyse + créneau proposé + dossier
  const { data: anaRow, error: anaErr } = await admin
    .from('mails_analyses')
    .select('dossier_match_id, creneau_propose_id')
    .eq('thread_id', threadId)
    .maybeSingle();
  if (anaErr) return NextResponse.json({ success: false, error: anaErr.message }, { status: 500 });
  if (!anaRow) {
    return NextResponse.json({ success: false, error: 'Mail non analysé.' }, { status: 404 });
  }
  const ana = anaRow as { dossier_match_id: string | null; creneau_propose_id: string | null };
  if (!ana.creneau_propose_id) {
    return NextResponse.json(
      { success: false, error: 'Aucun créneau proposé sur cette analyse.' },
      { status: 400 },
    );
  }
  if (!ana.dossier_match_id) {
    return NextResponse.json(
      { success: false, error: 'Aucun dossier rattaché à cette analyse.' },
      { status: 400 },
    );
  }

  // 2. Récup créneau (date + horaires + tech)
  const { data: creRow, error: creErr } = await admin
    .from('creneaux_disponibles')
    .select('id, date, heure_debut, heure_fin, technicien_id, statut, intervention_id')
    .eq('id', ana.creneau_propose_id)
    .maybeSingle();
  if (creErr || !creRow) {
    return NextResponse.json({ success: false, error: 'Créneau introuvable.' }, { status: 404 });
  }
  const cre = creRow as {
    id: string;
    date: string;
    heure_debut: string;
    heure_fin: string;
    technicien_id: string | null;
    statut: string;
    intervention_id: string | null;
  };
  // Créneau utilisable = libre, OU déjà réservé pour ce même dossier (c'est
  // ce que fait confirm-and-create à la création). Tout autre état = refus.
  const reservePourCeDossier =
    cre.statut === 'reserve' && cre.intervention_id === ana.dossier_match_id;
  if (cre.statut !== 'libre' && !reservePourCeDossier) {
    return NextResponse.json(
      { success: false, error: `Créneau déjà ${cre.statut} — impossible de réserver.` },
      { status: 409 },
    );
  }

  // 3. Récup dossier (ref + adresse + drive folder)
  const { data: ivRow } = await admin
    .from('interventions')
    .select('ref, adresse, drive_folder_id')
    .eq('id', ana.dossier_match_id)
    .maybeSingle();
  const dossier = ivRow as { ref: string | null; adresse: string | null; drive_folder_id: string | null } | null;

  // 4. Récup tech (email + nom)
  let techEmail: string | undefined;
  let techNom = '?';
  if (cre.technicien_id) {
    const { data: techRow } = await admin
      .from('utilisateurs')
      .select('email, prenom, nom')
      .eq('id', cre.technicien_id)
      .maybeSingle();
    if (techRow) {
      const t = techRow as { email: string | null; prenom: string | null; nom: string | null };
      techEmail = t.email ?? undefined;
      techNom = [t.prenom, t.nom].filter(Boolean).join(' ').trim() || 'Technicien';
    }
  }

  // 5. Création event Calendar
  // Heure belge → instant UTC exact (heure d'été / d'hiver gérée).
  const startIso = brusselsWallTimeToIso(cre.date, cre.heure_debut);
  const endIso = brusselsWallTimeToIso(cre.date, cre.heure_fin);
  const summary = dossier?.ref
    ? `${dossier.ref} — ${dossier.adresse ?? '?'}`
    : `Intervention FoxO — ${dossier?.adresse ?? '?'}`;
  const driveLine = dossier?.drive_folder_id
    ? `\nLien Drive : https://drive.google.com/drive/folders/${dossier.drive_folder_id}`
    : '';
  const description = `Intervention FoxO\nTech : ${techNom}\nAdresse : ${dossier?.adresse ?? '?'}${driveLine}`;

  const evRes = await createCalendarEvent({
    startIso,
    endIso,
    summary,
    description,
    location: dossier?.adresse ?? undefined,
    technicienEmail: techEmail,
  });
  if (!evRes.ok) {
    return NextResponse.json({ success: false, error: evRes.error }, { status: 502 });
  }

  // 6. UPDATE creneaux_disponibles → 'reserve', rattaché au dossier
  await admin
    .from('creneaux_disponibles')
    .update({ statut: 'reserve', intervention_id: ana.dossier_match_id })
    .eq('id', cre.id);

  // 7. UPDATE intervention → creneau_debut + technicien_id + statut='confirmee'
  //    (option B — pas de FK creneau_id, on dérive depuis le créneau choisi)
  const creneauDebutIso = startIso;
  await admin
    .from('interventions')
    .update({
      creneau_debut: creneauDebutIso,
      technicien_id: cre.technicien_id,
      statut: 'confirmee',
      updated_at: new Date().toISOString(),
    })
    .eq('id', ana.dossier_match_id);

  // 8. Persiste event_calendar_id sur mails_analyses
  await admin
    .from('mails_analyses')
    .update({
      event_calendar_id: evRes.event_id,
      updated_at: new Date().toISOString(),
    })
    .eq('thread_id', threadId);

  return NextResponse.json({
    success: true,
    event_id: evRes.event_id,
    event_url: evRes.html_link ?? null,
  });
}
