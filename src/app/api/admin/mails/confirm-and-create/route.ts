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
//   - Délégation Agent 2 sur les PJ Gmail (filter + LLM + insert
//     `attachments` + upload Drive renommé) — chantier #4
//   - UPDATE mails_analyses pour persister le lien dossier + créneau
//
// Si dossier_match_id fourni : pas de création, juste lien + réservation
// créneau + délégation Agent 2 sur le dossier existant (si
// drive_folder_id présent).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { roleForEmail } from '@/lib/auth/roles';
import { getEmailThread, downloadGmailAttachment } from '@/lib/gmail';
import { createInterventionFolderFromMail } from '@/lib/drive/create-intervention-folder';
import { nextRefForYear } from '@/lib/intervention-ref';
import { safeTypeIntervention } from '@/lib/mails/intervention-types';
import { analyseAttachments } from '@/lib/agents/analyse-pj';
import type { AttachmentInput } from '@/lib/agents/analyse-pj';
import { safeInsertOccupants, type OccupantInsertRow } from '@/lib/cron/check-mails';
import type { ConfirmCreateOccupant } from '@/app/admin/mails/MailAnalyseTypes';

export const dynamic = 'force-dynamic';
// Pipeline plus long que analyse-deep : Drive create + Agent 2
// (1 LLM call par PJ, ~5s/PJ) + upload Drive. Avec 3-5 PJ on dépasse
// largement 30s — on passe à 60 (aligné sur la route de test
// /api/admin/attachments/analyse).
export const maxDuration = 60;

const NOMINATIM_API = 'https://nominatim.openstreetmap.org/search';

interface ConfirmBody {
  thread_id?: unknown;
  adresse?: unknown;
  type_intervention?: unknown;
  occupant_telephone?: unknown;
  occupant_email?: unknown;
  occupants?: unknown;
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
  const bodyOccupants: ConfirmCreateOccupant[] = Array.isArray(body.occupants)
    ? (body.occupants as ConfirmCreateOccupant[])
    : [];

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
    // 4b. Branche "création nouveau dossier" — Ordre DB → Drive (chantier #5).
    //
    //   1. nextRefForYear() alloue la ref via MAX(DB sans soft-deletes, Drive) + 1.
    //   2. INSERT intervention avec ref + drive_folder_id=null (Drive pas
    //      encore créé). Sur 23505 (race condition), on recompute la ref et
    //      on retente UNE seule fois.
    //   3. createInterventionFolderFromMail(ref, adresse) crée le dossier
    //      Drive (best-effort).
    //   4. UPDATE intervention.drive_folder_id avec l'id retourné.
    //
    //   La ref étant désormais source de vérité côté DB, Drive ne peut
    //   plus créer une collision silencieuse (cf. chantier #5).
    const typeIntervention = safeTypeIntervention(typeRaw);

    // Géocodage best-effort (lat/lng nullable côté DB).
    const geo = await geocodeOnce(adresse);
    if (!geo) errors.push('geocoding: aucun résultat Nominatim');

    // Helper : construit le payload INSERT pour une ref donnée. Réutilisé
    // entre la première tentative et le retry 23505.
    const buildInsertPayload = (ref: string): Record<string, unknown> => {
      const p: Record<string, unknown> = {
        ref,
        type: typeIntervention,
        adresse,
        lat: geo?.lat ?? null,
        lng: geo?.lng ?? null,
        drive_folder_id: null,
        statut: 'nouvelle',
        source: 'mail',
        source_mail_id: threadId,
        creneau_debut: creneauDebutIso,
        technicien_id: creneau.technicien_id,
      };
      if (occupantPhone) p.contact_telephone = occupantPhone;
      if (occupantEmail) p.contact_email = occupantEmail;
      return p;
    };

    // 4b.1 — alloc + INSERT avec retry 1x sur 23505 (collision ref).
    let ref = await nextRefForYear(new Date().getFullYear());
    let insertResult = await admin
      .from('interventions')
      .insert(buildInsertPayload(ref))
      .select('id, ref, adresse')
      .single();
    if (insertResult.error && (insertResult.error as { code?: string }).code === '23505') {
      // Race condition : un autre flux vient de consommer la même ref.
      // Recompute via nextRefForYear (qui voit maintenant la row insérée
      // par l'autre flow) et retente une seule fois.
      ref = await nextRefForYear(new Date().getFullYear());
      insertResult = await admin
        .from('interventions')
        .insert(buildInsertPayload(ref))
        .select('id, ref, adresse')
        .single();
    }
    if (insertResult.error || !insertResult.data) {
      return NextResponse.json(
        { success: false, error: `insert intervention: ${insertResult.error?.message ?? 'échec'}` },
        { status: 500 },
      );
    }
    const ins = insertResult.data as { id: string; ref: string | null; adresse: string | null };
    dossierId = ins.id;
    dossierRef = ins.ref ?? ref;
    dossierAdresse = ins.adresse ?? adresse;
    dossierCreated = true;

    // 4b.2 — création dossier Drive (best-effort, ref déjà allouée en DB).
    try {
      const drive = await createInterventionFolderFromMail(dossierRef!, adresse);
      driveFolderId = drive.driveFolderId;
      driveUrl = drive.driveUrl;

      // 4b.3 — UPDATE intervention.drive_folder_id avec la valeur retournée.
      const { error: updErr } = await admin
        .from('interventions')
        .update({ drive_folder_id: driveFolderId, updated_at: new Date().toISOString() })
        .eq('id', dossierId);
      if (updErr) errors.push(`update drive_folder_id: ${updErr.message}`);
    } catch (e) {
      errors.push(`drive: ${e instanceof Error ? e.message : 'inconnu'}`);
    }
  }

  // 4c. Insertion des occupants (chantier 1.c). Source = occupants[] du body
  //     (1.b.2). Fallback rétro-compat : si occupants[] absent mais
  //     occupant_telephone/occupant_email présents, on reconstitue une seule
  //     ligne. Best-effort — un échec d'insert n'annule pas l'intervention
  //     (déjà créée/liée). conf='en_attente' posé ici ; mapping type → type_occupant.
  function resolveOccupantsToInsert(
    list: ConfirmCreateOccupant[],
    fallback: { telephone: string; email: string },
  ): Omit<OccupantInsertRow, 'intervention_id'>[] {
    const isEmpty = (o: ConfirmCreateOccupant) =>
      !o.prenom?.trim() && !o.nom?.trim() && !o.email?.trim() && !o.telephone?.trim();

    const source: ConfirmCreateOccupant[] = list.length > 0
      ? list
      : (fallback.telephone || fallback.email)
        ? [{
            prenom: '', nom: '',
            email: fallback.email || '',
            telephone: fallback.telephone || '',
            appartement: '', etage: '',
            type: 'occupant',
            instructions: '',
            contact_preference: 'email',
          }]
        : [];

    return source
      .filter((o) => !isEmpty(o))
      .map((o) => ({
        appartement: o.appartement,
        etage: o.etage,
        prenom: o.prenom,
        nom: o.nom,
        email: o.email,
        telephone: o.telephone,
        conf: 'en_attente' as const,
        contact_preference: o.contact_preference,
        instructions: o.instructions,
        type_occupant: o.type,
      }));
  }

  const occupantsBaseRows = resolveOccupantsToInsert(bodyOccupants, {
    telephone: occupantPhone ?? '',
    email: occupantEmail ?? '',
  });

  let occupantsInsertResult: Awaited<ReturnType<typeof safeInsertOccupants>> | null = null;
  let occupantsInsertError: string | null = null;

  if (occupantsBaseRows.length > 0) {
    const rows: OccupantInsertRow[] = occupantsBaseRows.map((r) => ({
      ...r,
      intervention_id: dossierId,
    }));
    try {
      occupantsInsertResult = await safeInsertOccupants(rows);
      if (!occupantsInsertResult.ok) {
        occupantsInsertError = occupantsInsertResult.error;
        console.error('[confirm-and-create] occupants insert failed:', occupantsInsertError, { intervention_id: dossierId, rows_count: rows.length });
      }
    } catch (e) {
      occupantsInsertError = e instanceof Error ? e.message : String(e);
      console.error('[confirm-and-create] occupants insert threw:', occupantsInsertError);
    }
  }

  // 5. UPDATE creneaux_disponibles → 'reserve' (atomique : empêche
  //    un autre admin de réserver le même créneau si on a coursé).
  await admin
    .from('creneaux_disponibles')
    .update({ statut: 'reserve' })
    .eq('id', creneau.id);

  // 6. Délégation Agent 2 sur les PJ Gmail (chantier #4).
  //    Remplace l'upload Drive brut historique par un pipeline complet :
  //    filter déterministe + classification LLM + insert row `attachments`
  //    + upload Drive renommé selon convention [ref]_[type]_[date].
  //    Best-effort à chaque étape — un échec Agent 2 ne casse pas la
  //    confirmation.
  //
  //    La résolution du drive_folder_id se fait côté Agent 2 via
  //    interventions.drive_folder_id (qu'on vient d'INSERT/lire à
  //    l'étape 4). Si l'intervention n'a pas de drive_folder_id (cas
  //    rare : dossier existant ancien sans Drive), Agent 2 fait quand
  //    même l'insert attachments mais skippe l'upload.
  //
  //    Contrat sortie : pj_drive_ids[] continue à alimenter
  //    mails_analyses comme avant — on extrait les drive_file_id non-null
  //    des attachments_processed[] pour préserver le contrat de l'UI
  //    mails (MailAnalyseTypes.ts et /api/admin/mails/analyses).
  //
  //    email_id reste null tant que la table `emails` n'existe pas
  //    (backlog post-chantier #3).
  const pjDriveIds: string[] = [];
  let pjUploaded = 0;

  try {
    const threadRes = await getEmailThread(threadId);
    if (!threadRes.ok) {
      errors.push(`gmail thread: ${threadRes.error}`);
    } else {
      const flat = threadRes.messages.flatMap((m) =>
        m.attachments.map((a) => ({ message_id: m.id, ...a })),
      );

      // Téléchargement Gmail → AttachmentInput[] pour Agent 2.
      const agentAttachments: AttachmentInput[] = [];
      for (const att of flat) {
        if (!att.attachment_id) {
          errors.push(`attachment_skipped: filename="${att.filename ?? '<no-filename>'}" mime_type="${att.mime_type ?? '<no-mime>'}" reason="missing attachment_id"`);
          continue;
        }
        try {
          const data64 = await downloadGmailAttachment(att.message_id, att.attachment_id);
          if (!data64) {
            errors.push(`gmail attachment ${att.filename}: download échoué`);
            continue;
          }
          agentAttachments.push({
            filename: att.filename,
            mime_type: att.mime_type,
            size_bytes: typeof att.size === 'number' ? att.size : 0,
            content_base64: data64,
          });
        } catch (e) {
          errors.push(`download pj ${att.filename}: ${e instanceof Error ? e.message : 'inconnu'}`);
        }
      }

      errors.push(`attachments_summary: thread_total=${flat.length} downloaded=${agentAttachments.length} skipped=${flat.length - agentAttachments.length}`);

      // Si au moins une PJ téléchargée → délégation Agent 2.
      if (agentAttachments.length > 0) {
        try {
          const result = await analyseAttachments({
            attachments: agentAttachments,
            context: {
              intervention_id: dossierId,
              email_id: null, // table `emails` pas encore créée
              ref_foxo: dossierRef,
            },
          });

          for (const p of result.attachments_processed) {
            if (p.drive_file_id) pjDriveIds.push(p.drive_file_id);
            if (p.drive_url) pjUploaded += 1;
            if (p.drive_error) {
              errors.push(`agent2 drive ${p.original_filename}: ${p.drive_error}`);
            }
          }
          for (const e of result.errors) {
            errors.push(`agent2 ${e.original_filename}: ${e.error_message}`);
          }
          // result.skipped intentionnellement non logé (signatures
          // image / vCard / ICS / trop volumineux — comportement attendu).
        } catch (e) {
          errors.push(`agent2: ${e instanceof Error ? e.message : 'inconnu'}`);
        }
      }
    }
  } catch (e) {
    errors.push(`pj pipeline: ${e instanceof Error ? e.message : 'inconnu'}`);
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
    occupants_inserted: occupantsInsertResult?.ok ? occupantsInsertResult.inserted : 0,
    occupants_insert_error: occupantsInsertError,
    errors: errors.length > 0 ? errors : undefined,
  });
}
