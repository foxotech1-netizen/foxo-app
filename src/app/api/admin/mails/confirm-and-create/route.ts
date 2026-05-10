// POST /api/admin/mails/confirm-and-create
// Body : {
//   thread_id: string,
//   adresse: string,
//   type_intervention: string,
//   occupant_telephone: string | null,
//   occupant_email: string | null,
//   creneau_id: string,
//   dossier_match_id: string | null  // si admin a manuellement matché
// }
//
// Étape de validation manuelle après analyse-deep (lecture seule).
// Effectue tous les side-effects destructifs :
//   - Géocodage Nominatim (best-effort)
//   - Création dossier Drive (createInterventionFolderFromMail)
//   - INSERT intervention
//   - Réservation créneau (statut='reserve')
//   - Upload des PJ Gmail dans le dossier Drive
//   - UPDATE mails_analyses pour persister le lien dossier + créneau
//
// Si dossier_match_id fourni : pas de création, juste lien + réservation
// créneau + upload PJ vers le dossier existant (si drive_folder_id présent).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { roleForEmail } from '@/lib/auth/roles';
import { getEmailThread, downloadGmailAttachment } from '@/lib/gmail';
import {
  createInterventionFolderFromMail,
  uploadAttachmentToFolder,
} from '@/lib/drive/create-intervention-folder';
import { safeTypeIntervention } from '@/lib/mails/intervention-types';

export const dynamic = 'force-dynamic';
// Pipeline plus long que analyse-deep (Drive create + uploads PJ),
// jusqu'à 30s sur un thread avec plusieurs PJ lourdes.
export const maxDuration = 30;

const NOMINATIM_API = 'https://nominatim.openstreetmap.org/search';

interface ConfirmBody {
  thread_id?: unknown;
  adresse?: unknown;
  type_intervention?: unknown;
  occupant_telephone?: unknown;
  occupant_email?: unknown;
  creneau_id?: unknown;
  dossier_match_id?: unknown;
}

interface NominatimItem { lat: string; lon: string }

async function geocodeOnce(query: string): Promise<{ lat: number; lng: number } | null> {
  if (!query.trim()) return null;
  try {
    const url = `${NOMINATIM_API}?format=json&limit=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'foxo-app/1.0 (info@foxo.be)',
        'Accept-Language': 'fr-BE,fr;q=0.9',
      },
    });
    if (!res.ok) return null;
    const items = (await res.json()) as NominatimItem[];
    if (!items[0]) return null;
    const lat = Number.parseFloat(items[0].lat);
    const lng = Number.parseFloat(items[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ success: false, error: 'Accès refusé.' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as ConfirmBody;
  const threadId = typeof body.thread_id === 'string' ? body.thread_id.trim() : '';
  const adresse = typeof body.adresse === 'string' ? body.adresse.trim() : '';
  const typeRaw = typeof body.type_intervention === 'string' ? body.type_intervention.trim() : '';
  const creneauId = typeof body.creneau_id === 'string' ? body.creneau_id.trim() : '';
  const occupantPhone = typeof body.occupant_telephone === 'string' && body.occupant_telephone.trim()
    ? body.occupant_telephone.trim()
    : null;
  const occupantEmail = typeof body.occupant_email === 'string' && body.occupant_email.trim()
    ? body.occupant_email.trim()
    : null;
  const matchId = typeof body.dossier_match_id === 'string' && body.dossier_match_id.trim()
    ? body.dossier_match_id.trim()
    : null;

  if (!threadId || !creneauId) {
    return NextResponse.json(
      { success: false, error: 'thread_id + creneau_id requis.' },
      { status: 400 },
    );
  }
  if (!matchId && !adresse) {
    return NextResponse.json(
      { success: false, error: 'adresse requise (sauf si dossier_match_id fourni).' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // 1. Vérifier que l'analyse existe (mails_analyses doit avoir une row
  //    pour que le UPDATE final passe). Si l'admin a forcé un thread non
  //    analysé, on remonte une erreur — il doit lancer analyse-deep avant.
  const { data: ana, error: anaErr } = await admin
    .from('mails_analyses')
    .select('thread_id')
    .eq('thread_id', threadId)
    .maybeSingle();
  if (anaErr) return NextResponse.json({ success: false, error: anaErr.message }, { status: 500 });
  if (!ana) {
    return NextResponse.json(
      { success: false, error: 'Mail non analysé — lance analyse-deep d\'abord.' },
      { status: 404 },
    );
  }

  // 2. Vérifier le créneau (dispo + horaires + tech).
  const { data: creRow, error: creErr } = await admin
    .from('creneaux_disponibles')
    .select('id, date, heure_debut, heure_fin, technicien_id, statut')
    .eq('id', creneauId)
    .maybeSingle();
  if (creErr || !creRow) {
    return NextResponse.json({ success: false, error: 'Créneau introuvable.' }, { status: 404 });
  }
  const creneau = creRow as {
    id: string;
    date: string;
    heure_debut: string;
    heure_fin: string;
    technicien_id: string | null;
    statut: string;
  };
  if (creneau.statut !== 'libre') {
    return NextResponse.json(
      { success: false, error: `Créneau déjà ${creneau.statut} — choisis un autre.` },
      { status: 409 },
    );
  }
  // Construit le timestamp creneau_debut (Europe/Brussels). Pas de
  // DST handling subtil : Belgique = +01/+02 selon période, on hard-code
  // +02 pour la majeure partie de l'année — refacto possible si besoin.
  const creneauDebutIso = `${creneau.date}T${creneau.heure_debut.slice(0, 5)}:00+02:00`;

  // 3. Récup tech name pour la réponse.
  let techNom = '?';
  if (creneau.technicien_id) {
    const { data: tech } = await admin
      .from('utilisateurs')
      .select('prenom, nom')
      .eq('id', creneau.technicien_id)
      .maybeSingle();
    if (tech) {
      const t = tech as { prenom: string | null; nom: string | null };
      techNom = [t.prenom, t.nom].filter(Boolean).join(' ').trim() || 'Technicien';
    }
  }

  const errors: string[] = [];
  let dossierId: string;
  let dossierRef: string | null = null;
  let dossierAdresse: string;
  let driveFolderId: string | null = null;
  let driveUrl: string | null = null;
  let dossierCreated = false;

  // 4a. Branche "lien à un dossier existant" — pas de création, juste UPDATE
  if (matchId) {
    const { data: existing, error: exErr } = await admin
      .from('interventions')
      .select('id, ref, adresse, drive_folder_id')
      .eq('id', matchId)
      .maybeSingle();
    if (exErr || !existing) {
      return NextResponse.json({ success: false, error: 'Dossier existant introuvable.' }, { status: 404 });
    }
    const ex = existing as { id: string; ref: string | null; adresse: string | null; drive_folder_id: string | null };
    dossierId = ex.id;
    dossierRef = ex.ref;
    dossierAdresse = ex.adresse ?? adresse;
    driveFolderId = ex.drive_folder_id;
    driveUrl = driveFolderId ? `https://drive.google.com/drive/folders/${driveFolderId}` : null;

    // UPDATE intervention pour réserver le créneau (creneau_debut + tech)
    // sans changer le statut (le dossier existant peut être 'attente',
    // 'confirmee'… on ne le rétrograde pas).
    await admin
      .from('interventions')
      .update({
        creneau_debut: creneauDebutIso,
        technicien_id: creneau.technicien_id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', dossierId);
  } else {
    // 4b. Branche "création nouveau dossier" — Drive + INSERT.
    const typeIntervention = safeTypeIntervention(typeRaw);

    // Géocodage best-effort (lat/lng nullable côté DB).
    const geo = await geocodeOnce(adresse);
    if (!geo) errors.push('geocoding: aucun résultat Nominatim');

    // Drive : crée le dossier RAPPORTS/{year}/{ref + adresse}/photos/
    // ET alloue la prochaine ref via generateNextRef.
    let createdRef: string | null = null;
    let createdFolderId: string | null = null;
    let createdFolderUrl: string | null = null;
    try {
      const drive = await createInterventionFolderFromMail(adresse);
      createdRef = drive.ref;
      createdFolderId = drive.folder_id;
      createdFolderUrl = drive.url;
    } catch (e) {
      errors.push(`drive: ${e instanceof Error ? e.message : 'inconnu'}`);
    }

    const insertPayload: Record<string, unknown> = {
      ref: createdRef,
      type: typeIntervention,
      adresse,
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
      drive_folder_id: createdFolderId,
      statut: 'nouvelle',
      source: 'mail',
      source_mail_id: threadId,
      creneau_debut: creneauDebutIso,
      technicien_id: creneau.technicien_id,
    };
    // contact_telephone / contact_email : insertion tolérante — si la
    // colonne n'existe pas en DB, le retry strippe et continue. Les
    // schémas récents ont ces colonnes ; les anciens utilisent
    // particulier_contact (jsonb).
    if (occupantPhone) insertPayload.contact_telephone = occupantPhone;
    if (occupantEmail) insertPayload.contact_email = occupantEmail;

    const { data: inserted, error: insErr } = await admin
      .from('interventions')
      .insert(insertPayload)
      .select('id, ref, adresse')
      .single();
    if (insErr || !inserted) {
      return NextResponse.json(
        { success: false, error: `insert intervention: ${insErr?.message ?? 'échec'}` },
        { status: 500 },
      );
    }
    const ins = inserted as { id: string; ref: string | null; adresse: string | null };
    dossierId = ins.id;
    dossierRef = ins.ref ?? createdRef;
    dossierAdresse = ins.adresse ?? adresse;
    driveFolderId = createdFolderId;
    driveUrl = createdFolderUrl;
    dossierCreated = true;
  }

  // 5. UPDATE creneaux_disponibles → 'reserve' (atomique : empêche
  //    un autre admin de réserver le même créneau si on a coursé).
  await admin
    .from('creneaux_disponibles')
    .update({ statut: 'reserve' })
    .eq('id', creneau.id);

  // 6. Upload des PJ Gmail dans le dossier Drive (si drive_folder_id
  //    disponible — un dossier existant peut ne pas en avoir).
  const pjDriveIds: string[] = [];
  let pjUploaded = 0;
  if (driveFolderId) {
    const threadRes = await getEmailThread(threadId);
    if (threadRes.ok) {
      const flat = threadRes.messages.flatMap((m) =>
        m.attachments.map((a) => ({ message_id: m.id, ...a })),
      );
      for (const att of flat) {
        if (!att.attachment_id) continue;
        try {
          const data64 = await downloadGmailAttachment(att.message_id, att.attachment_id);
          if (!data64) {
            errors.push(`gmail attachment ${att.filename}: download échoué`);
            continue;
          }
          const up = await uploadAttachmentToFolder({
            folder_id: driveFolderId,
            filename: att.filename,
            mime_type: att.mime_type,
            data_base64: data64,
          });
          pjDriveIds.push(up.file_id);
          pjUploaded += 1;
        } catch (e) {
          errors.push(`upload pj ${att.filename}: ${e instanceof Error ? e.message : 'inconnu'}`);
        }
      }
    } else {
      errors.push(`gmail thread: ${threadRes.error}`);
    }
  }

  // 7. UPDATE mails_analyses : persiste le lien dossier + créneau + PJ.
  //    pj_drive_ids accumulé : si l'analyse était relancée plusieurs fois
  //    on remplace (le merge serait piégeux côté re-confirm — l'admin
  //    relance rarement confirm-and-create sur un mail déjà confirmé).
  await admin
    .from('mails_analyses')
    .update({
      dossier_match_id: dossierId,
      creneau_propose_id: creneau.id,
      pj_drive_ids: pjDriveIds,
      updated_at: new Date().toISOString(),
    })
    .eq('thread_id', threadId);

  return NextResponse.json({
    success: true,
    dossier: {
      id: dossierId,
      ref: dossierRef,
      adresse: dossierAdresse,
      drive_url: driveUrl,
      created: dossierCreated,
    },
    creneau: {
      date: creneau.date,
      heure: creneau.heure_debut.slice(0, 5),
      tech_nom: techNom,
    },
    pj_uploaded: pjUploaded,
    errors: errors.length > 0 ? errors : undefined,
  });
}
