// POST /api/admin/mails/confirm-and-create
// Body : {
//   thread_id: string,
//   adresse: string,
//   type_intervention: string,
//   occupant_telephone: string | null,
//   occupant_email: string | null,
//   creneau_id: string | null,       // optionnel : création « sans créneau »
//   dossier_match_id: string | null  // si admin a manuellement matché
// }
//
// Étape de validation manuelle après analyse-deep (lecture seule).
// Effectue tous les side-effects destructifs :
//   - Géocodage Nominatim (best-effort)
//   - Réservation créneau (statut='reserve' + intervention_id) — seulement
//     si un creneau_id est fourni ; sinon le dossier est créé « à planifier »
//   - INSERT intervention
//   - Création dossier Drive (createInterventionFolderFromMail)
//   - UPDATE mails_analyses pour persister le lien dossier + créneau
//     (AVANT le pipeline PJ : un timeout PJ ne laisse plus de dossier orphelin)
//   - Délégation Agent 2 sur les PJ Gmail (filter + LLM + insert
//     `attachments` + upload Drive renommé) — chantier #4
//
// Si dossier_match_id fourni : pas de création, juste lien + délégation
// Agent 2 sur le dossier existant (si drive_folder_id présent). Le planning
// du dossier existant n'est JAMAIS modifié par cette route (pas de
// réservation de créneau, pas de notification occupant).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from "@/lib/auth/server";
import { getEmailThread, downloadGmailAttachment } from '@/lib/gmail';
import { createInterventionFolderFromMail } from '@/lib/drive/create-intervention-folder';
import { nextRefForYear } from '@/lib/intervention-ref';
import { safeTypeIntervention } from '@/lib/mails/intervention-types';
import { analyseAttachments } from '@/lib/agents/analyse-pj';
import type { AttachmentInput } from '@/lib/agents/analyse-pj';
import { safeInsertOccupants, type OccupantInsertRow } from '@/lib/cron/check-mails';
import { notifyOccupantsForIntervention } from '@/lib/occupants/notify-occupants';
import { brusselsWallTimeToIso, fmtDateISO } from '@/lib/format';
import type { ConfirmCreateOccupant } from '@/app/admin/mails/MailAnalyseTypes';

export const dynamic = 'force-dynamic';
// Pipeline plus long que analyse-deep : Drive create + Agent 2
// (1 LLM call par PJ, ~5s/PJ) + upload Drive. Avec 3-5 PJ on dépasse
// largement 30s — on passe à 60 (aligné sur la route de test
// /api/admin/attachments/analyse).
export const maxDuration = 60;

const NOMINATIM_API = 'https://nominatim.openstreetmap.org/search';

// Garde-fous du pipeline PJ : un fil syndic ré-attache souvent les mêmes
// pièces à chaque réponse (plusieurs dizaines de Mo au total). On dédoublonne
// avant téléchargement, on plafonne le nombre de PJ et on borne le temps de
// téléchargement pour rester sous maxDuration.
const PJ_MAX_COUNT = 10;
const PJ_DOWNLOAD_BUDGET_MS = 20_000;

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
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ success: false, error: 'Accès refusé.' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as ConfirmBody;
  const threadId = typeof body.thread_id === 'string' ? body.thread_id.trim() : '';
  const adresse = typeof body.adresse === 'string' ? body.adresse.trim() : '';
  const typeRaw = typeof body.type_intervention === 'string' ? body.type_intervention.trim() : '';
  const creneauId = typeof body.creneau_id === 'string' && body.creneau_id.trim()
    ? body.creneau_id.trim()
    : null;
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

  if (!threadId) {
    return NextResponse.json(
      { success: false, error: 'thread_id requis.' },
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
    .select('thread_id, resume, urgence, dossier_match_id')
    .eq('thread_id', threadId)
    .maybeSingle();
  if (anaErr) return NextResponse.json({ success: false, error: anaErr.message }, { status: 500 });
  if (!ana) {
    return NextResponse.json(
      { success: false, error: 'Mail non analysé — lance analyse-deep d\'abord.' },
      { status: 404 },
    );
  }
  const anaRow = ana as {
    thread_id: string;
    resume: string | null;
    urgence: boolean | null;
    dossier_match_id: string | null;
  };
  // Anti-doublon : une création est demandée alors que ce fil est déjà
  // rattaché à un dossier (double clic, nouvelle tentative après un délai
  // dépassé…). On refuse plutôt que de créer un second dossier.
  if (!matchId && anaRow.dossier_match_id) {
    return NextResponse.json(
      { success: false, error: 'Ce mail est déjà rattaché à un dossier — recharge la page.' },
      { status: 409 },
    );
  }

  // 2. Créneau (OPTIONNEL). Vérifié uniquement en mode création : en mode
  //    « lier à un dossier existant », le planning du dossier n'est jamais
  //    modifié par cette route (creneau_id éventuel ignoré).
  interface CreneauRow {
    id: string;
    date: string;
    heure_debut: string;
    heure_fin: string;
    technicien_id: string | null;
    statut: string;
  }
  let creneau: CreneauRow | null = null;
  let creneauDebutIso: string | null = null;
  if (creneauId && !matchId) {
    const { data: creRow, error: creErr } = await admin
      .from('creneaux_disponibles')
      .select('id, date, heure_debut, heure_fin, technicien_id, statut')
      .eq('id', creneauId)
      .maybeSingle();
    if (creErr || !creRow) {
      return NextResponse.json({ success: false, error: 'Créneau introuvable — actualise les créneaux.' }, { status: 404 });
    }
    const row = creRow as CreneauRow;
    if (row.statut !== 'libre') {
      return NextResponse.json(
        { success: false, error: `Créneau déjà ${row.statut} — choisis-en un autre.` },
        { status: 409 },
      );
    }
    // Date du jour en heure belge (YYYY-MM-DD) : un créneau resté « libre »
    // dans le passé ne doit pas pouvoir être réservé.
    if (row.date < fmtDateISO(new Date().toISOString())) {
      return NextResponse.json(
        { success: false, error: 'Ce créneau est déjà passé — choisis-en un autre.' },
        { status: 409 },
      );
    }
    creneau = row;
    // Heure belge → instant UTC exact (heure d'été / d'hiver gérée).
    creneauDebutIso = brusselsWallTimeToIso(row.date, row.heure_debut);
  }

  // 3. Récup tech name pour la réponse.
  let techNom = '?';
  if (creneau?.technicien_id) {
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

  // 4a. Branche "lien à un dossier existant" — pas de création, aucun UPDATE
  //     du dossier (ni créneau, ni technicien, ni statut).
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
        priorite: anaRow.urgence ? 'urgente' : 'normale',
        source: 'mail',
        source_mail_id: threadId,
        // null si le dossier est créé « sans créneau » (à planifier ensuite).
        creneau_debut: creneauDebutIso,
        technicien_id: creneau?.technicien_id ?? null,
      };
      if (anaRow.resume?.trim()) p.description = anaRow.resume.trim();
      if (occupantPhone) p.contact_telephone = occupantPhone;
      if (occupantEmail) p.contact_email = occupantEmail;
      return p;
    };

    // 4b.0 — allocation de la ref AVANT de verrouiller le créneau (elle
    //        inclut un scan Drive de plusieurs secondes : on ne tient pas le
    //        créneau pendant ce temps).
    let ref = await nextRefForYear(new Date().getFullYear());

    // 4b.0-bis — réservation ATOMIQUE du créneau juste avant l'INSERT : le
    //        filtre statut='libre' garantit qu'un seul flux peut le prendre.
    //        Si l'INSERT échoue ensuite, le créneau est libéré (releaseCreneau).
    const releaseCreneau = async () => {
      if (!creneau) return;
      await admin
        .from('creneaux_disponibles')
        .update({ statut: 'libre', intervention_id: null })
        .eq('id', creneau.id);
    };
    if (creneau) {
      const { data: locked, error: lockErr } = await admin
        .from('creneaux_disponibles')
        .update({ statut: 'reserve' })
        .eq('id', creneau.id)
        .eq('statut', 'libre')
        .select('id');
      if (lockErr || !locked || locked.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Ce créneau vient d\'être réservé — choisis-en un autre.' },
          { status: 409 },
        );
      }
    }

    // 4b.1 — INSERT avec retry 1x sur 23505 (collision ref).
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
      await releaseCreneau();
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

    // 4b.1-bis — rattache le créneau réservé à l'intervention (le planning
    //            affiche et libère les créneaux via intervention_id).
    if (creneau) {
      const { error: linkErr } = await admin
        .from('creneaux_disponibles')
        .update({ intervention_id: dossierId })
        .eq('id', creneau.id);
      if (linkErr) errors.push(`lien créneau → intervention: ${linkErr.message}`);
    }

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

  // 5. UPDATE mails_analyses : persiste le lien dossier (+ créneau retenu en
  //    mode création) AVANT le pipeline PJ. Si ce pipeline dépasse le délai
  //    de la fonction, le mail est déjà rattaché : pas de dossier orphelin,
  //    et la garde anti-doublon de l'étape 1 bloque toute seconde création.
  {
    const linkPatch: Record<string, unknown> = {
      dossier_match_id: dossierId,
      // Créneau réellement réservé ici, sinon null (création sans créneau,
      // ou mode « lien » : le créneau proposé à l'analyse n'a pas été choisi
      // et ne doit plus alimenter « Event Calendar » / « Confirmer occupant »).
      creneau_propose_id: creneau?.id ?? null,
      updated_at: new Date().toISOString(),
    };
    const { error: linkAnaErr } = await admin
      .from('mails_analyses')
      .update(linkPatch)
      .eq('thread_id', threadId);
    if (linkAnaErr) errors.push(`update mails_analyses (lien): ${linkAnaErr.message}`);
  }

  // 5-bis. Envoi best-effort de la demande de confirmation aux occupants pas
  //    encore notifiés (token_sent_at IS NULL). Effet de bord uniquement :
  //    réutilise le helper partagé notifyOccupantsForIntervention. TOUT échec
  //    est loggé et avalé — la création d'intervention doit réussir et renvoyer
  //    sa réponse de succès normale quoi qu'il arrive (jamais de 500 ici).
  //    Uniquement pour un dossier CRÉÉ ici AVEC un créneau réservé : sans
  //    créneau il n'y a rien à confirmer, et en mode « lien » on ne déclenche
  //    aucun envoi sur un dossier existant.
  //    Placé AVANT le pipeline PJ : c'est l'étape la plus longue, un
  //    dépassement de délai ne doit pas priver les occupants de leur demande.
  if (dossierCreated && creneau) {
    try {
      const { data: pending, error: pendingErr } = await admin
        .from('occupants')
        .select('id')
        .eq('intervention_id', dossierId)
        .is('token_sent_at', null);
      if (pendingErr) {
        console.error('[confirm-and-create] lecture occupants à notifier KO:', pendingErr.message, { intervention_id: dossierId });
      } else {
        const occupantIds: string[] = (pending ?? []).map((o) => o.id);
        if (occupantIds.length > 0) {
          const notifyRes = await notifyOccupantsForIntervention(dossierId, {
            occupantIds,
            sentBy: user.id ?? null,
          });
          if (!notifyRes.ok) {
            console.error('[confirm-and-create] notifyOccupantsForIntervention KO:', notifyRes.error, { intervention_id: dossierId, status: notifyRes.status });
          }
        }
      }
    } catch (e) {
      console.error('[confirm-and-create] envoi confirmation occupants threw:', e instanceof Error ? e.message : String(e), { intervention_id: dossierId });
    }
  }

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
      const flatAll = threadRes.messages.flatMap((m) =>
        m.attachments.map((a) => ({ message_id: m.id, ...a })),
      );

      // Dédoublonnage AVANT téléchargement : une même pièce ré-attachée à
      // chaque réponse du fil (même nom + même taille) n'est téléchargée
      // qu'une fois. L'anti-doublon par hash de contenu d'Agent 2 reste la
      // référence ; ceci évite seulement de télécharger N fois le même fichier.
      const seenPj = new Set<string>();
      const flatUnique = flatAll.filter((a) => {
        const key = `${(a.filename ?? '').toLowerCase()}|${typeof a.size === 'number' ? a.size : 0}`;
        if (seenPj.has(key)) return false;
        seenPj.add(key);
        return true;
      });
      const flat = flatUnique.slice(0, PJ_MAX_COUNT);
      if (flatUnique.length > flat.length) {
        errors.push(`attachments_capped: ${flatUnique.length - flat.length} PJ non traitée(s) (plafond ${PJ_MAX_COUNT}) — utilise « Joindre au dossier »`);
      }

      // Téléchargement Gmail → AttachmentInput[] pour Agent 2.
      const agentAttachments: AttachmentInput[] = [];
      const pjStartedAt = Date.now();
      for (const att of flat) {
        if (Date.now() - pjStartedAt > PJ_DOWNLOAD_BUDGET_MS) {
          errors.push(`attachments_budget: téléchargement interrompu après ${Math.round(PJ_DOWNLOAD_BUDGET_MS / 1000)} s — PJ restantes non traitées (utilise « Joindre au dossier »)`);
          break;
        }
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
            source_mail_id: att.message_id,
          });
        } catch (e) {
          errors.push(`download pj ${att.filename}: ${e instanceof Error ? e.message : 'inconnu'}`);
        }
      }

      errors.push(`attachments_summary: thread_total=${flatAll.length} unique=${flatUnique.length} downloaded=${agentAttachments.length} skipped=${flat.length - agentAttachments.length}`);

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

  // 7. UPDATE mails_analyses : PJ uploadées (le lien dossier + créneau est
  //    déjà persisté à l'étape 5). pj_drive_ids remplacé, pas fusionné.
  await admin
    .from('mails_analyses')
    .update({
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
    creneau: creneau
      ? {
          date: creneau.date,
          heure: creneau.heure_debut.slice(0, 5),
          tech_nom: techNom,
        }
      : null,
    pj_uploaded: pjUploaded,
    occupants_inserted: occupantsInsertResult?.ok ? occupantsInsertResult.inserted : 0,
    occupants_insert_error: occupantsInsertError,
    errors: errors.length > 0 ? errors : undefined,
  });
}
