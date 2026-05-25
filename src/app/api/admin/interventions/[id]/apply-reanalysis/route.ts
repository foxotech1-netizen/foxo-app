import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from "@/lib/auth/server";
import {
  matchOrCreateOrganisation,
  matchOrCreateClient,
  matchOrCreateDelegue,
  matchAcpForOrganisation,
  safeInsertOccupants,
  type CronMailAnalysis,
  type OccupantInsertRow,
} from '@/lib/cron/check-mails';
import type { Intervention, ParticulierContact } from '@/lib/types/database';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ALLOWED_TYPES = [
  'Fuite canalisation',
  'Fuite chauffage',
  'Fuite infiltration',
  'Surconsommation eau',
  'Autre',
] as const;

interface ApplyBody {
  analysis?: unknown;       // l'objet CronMailAnalysis renvoyé par /reanalyze
}

// Applique l'analyse renvoyée par /reanalyze à l'intervention existante.
// - Met à jour particulier_contact, type, description, priorite, adresse
// - Match/crée organisation_id ou client_id selon type_demandeur
// - Insère les nouveaux occupants extraits (email non déjà présent)
// - Insert intervention_timeline type='mail_reanalyse'
//
// Wrap top-level try/catch : tout throw imprévu est attrapé et le détail
// renvoyé dans le response body (utile pour debugger via DevTools quand
// l'admin n'a pas accès aux Vercel logs).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let phase = 'init';
  try {
    return await handlePOST(request, params, (p) => { phase = p; });
  } catch (e) {
    const err = e as Error & { code?: string; details?: string; hint?: string };
    console.error('[apply-reanalysis] uncaught throw', {
      phase,
      name: err.name,
      message: err.message,
      code: err.code ?? null,
      details: err.details ?? null,
      hint: err.hint ?? null,
      stack: err.stack?.slice(0, 2000) ?? null,
    });
    return NextResponse.json({
      ok: false,
      error: `Exception côté serveur (phase ${phase}): ${err.message}`,
      detail: {
        name: err.name,
        code: err.code ?? null,
        details: err.details ?? null,
        hint: err.hint ?? null,
        stack: err.stack?.split('\n').slice(0, 8).join('\n') ?? null,
        phase,
      },
    }, { status: 500 });
  }
}

async function handlePOST(
  request: Request,
  paramsPromise: Promise<{ id: string }>,
  setPhase: (p: string) => void,
): Promise<Response> {
  setPhase('auth');
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { id } = await paramsPromise;

  setPhase('parse_body');
  let body: ApplyBody;
  try {
    body = (await request.json()) as ApplyBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }
  // Trust Claude's output structure (validé en sortie de /reanalyze)
  const analysis = body.analysis as CronMailAnalysis | undefined;
  if (!analysis || typeof analysis !== 'object') {
    return NextResponse.json({ ok: false, error: 'analysis manquante.' }, { status: 400 });
  }
  // Log diagnostique : combien d'occupants on reçoit du client, avec
  // les champs critiques pour le filtre (apt/nom/email/tel).
  console.error('[apply-reanalysis] received occupants:',
    JSON.stringify(analysis.occupants ?? null));

  // Charge l'intervention
  setPhase('load_intervention');
  const { data: ivRow, error: ivErr } = await supabase
    .from('interventions')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (ivErr) {
    console.error('[apply-reanalysis] load intervention error', {
      intervention_id: id,
      code: (ivErr as { code?: string }).code ?? null,
      message: ivErr.message,
      details: (ivErr as { details?: string }).details ?? null,
    });
    return NextResponse.json({ ok: false, error: ivErr.message }, { status: 500 });
  }
  if (!ivRow) return NextResponse.json({ ok: false, error: 'Intervention introuvable.' }, { status: 404 });
  const intervention = ivRow as Intervention;

  setPhase('admin_client');
  const admin = createAdminClient();

  // Construction du nouveau particulier_contact (merge non-destructif)
  setPhase('build_particulier_contact');
  const pc = (intervention.particulier_contact as ParticulierContact | null) ?? null;
  const nextPc: ParticulierContact = pc ? { ...pc } : {
    prenom: '', nom: '', email: '', telephone: '',
    adresse: { rue: '', code_postal: '', ville: '' },
    mandant: { prenom: '', nom: '', email: '', tel: '', adresse_facturation: { rue: '', code_postal: '', ville: '' } },
    lieu: { meme_que_mandant: true, rue: '', cp: '', ville: '' },
    contact_sur_place: { actif: false },
  };
  if (analysis.nom_client) {
    const parts = analysis.nom_client.trim().split(/\s+/);
    const prenom = parts.length >= 2 ? parts[0] : '';
    const nom = parts.length >= 2 ? parts.slice(1).join(' ') : analysis.nom_client.trim();
    nextPc.prenom = prenom;
    nextPc.nom = nom;
    if (nextPc.mandant) { nextPc.mandant.prenom = prenom; nextPc.mandant.nom = nom; }
  }
  if (analysis.email) {
    nextPc.email = analysis.email;
    if (nextPc.mandant) nextPc.mandant.email = analysis.email;
  }
  if (analysis.telephone) {
    nextPc.telephone = analysis.telephone;
    if (nextPc.mandant) nextPc.mandant.tel = analysis.telephone;
  }
  if (analysis.adresse) {
    const m = analysis.adresse.match(/^(.+?),?\s*(\d{4})\s+(.+?)$/);
    const rue = m ? m[1].trim() : analysis.adresse.trim();
    const cp = m ? m[2].trim() : '';
    const ville = m ? m[3].trim() : '';
    nextPc.adresse = { rue, code_postal: cp, ville };
    if (nextPc.lieu) {
      nextPc.lieu.rue = rue; nextPc.lieu.cp = cp; nextPc.lieu.ville = ville;
    }
    if (nextPc.mandant?.adresse_facturation) {
      nextPc.mandant.adresse_facturation = { rue, code_postal: cp, ville };
    }
  }
  // Bloc assureur (extrait par le nouveau prompt FoxO) — stocké dans
  // particulier_contact.assureur. Override l'existant si Claude a re-extrait.
  if (analysis.assurance) {
    (nextPc as unknown as Record<string, unknown>).assureur = {
      nom: analysis.assurance.nom_contact,
      email: analysis.assurance.email,
      telephone: analysis.assurance.telephone,
      reference_police: analysis.assurance.reference_police,
    };
  }

  // Matching org/client (peut créer si nouveau)
  setPhase('match_org_or_client');
  let organisationId: string | null = intervention.organisation_id;
  let clientId: string | null = intervention.client_id;
  let delegueId: string | null = (intervention as { delegue_id?: string | null }).delegue_id ?? null;
  let acpId: string | null = intervention.acp_id;
  if (analysis.type_demandeur === 'syndic' || analysis.type_demandeur === 'courtier') {
    const matched = await matchOrCreateOrganisation({
      type: analysis.type_demandeur,
      nomSociete: analysis.nom_societe,
      email: analysis.email ?? '',
      telephone: analysis.telephone ?? '',
    });
    if (matched) organisationId = matched.id;

    // Délégué : si Claude a extrait des infos OU si on a un email du
    // sender, on match-or-create dans la table delegues.
    if (organisationId) {
      setPhase('match_delegue');
      const dEmail = analysis.delegue?.email ?? analysis.email ?? '';
      if (dEmail) {
        const matchedDel = await matchOrCreateDelegue({
          organisation_id: organisationId,
          email: dEmail,
          prenom: analysis.delegue?.prenom ?? null,
          nom: analysis.delegue?.nom ?? null,
          telephone: analysis.delegue?.telephone ?? analysis.telephone ?? null,
        });
        if (matchedDel) delegueId = matchedDel.id;
      }
      // ACP : ne change pas si déjà associée manuellement, sinon tente
      // un match par nom_immeuble (best effort).
      if (!acpId && analysis.nom_immeuble) {
        const matchedAcp = await matchAcpForOrganisation({
          organisation_id: organisationId,
          nom_immeuble: analysis.nom_immeuble,
        });
        if (matchedAcp) acpId = matchedAcp.id;
      }
    }
  } else if (analysis.type_demandeur === 'particulier') {
    const parts = (analysis.nom_client ?? '').trim().split(/\s+/);
    const matched = await matchOrCreateClient({
      prenom: parts.length >= 2 ? parts[0] : '',
      nom: parts.length >= 2 ? parts.slice(1).join(' ') : (analysis.nom_client ?? ''),
      email: analysis.email ?? '',
      telephone: analysis.telephone ?? '',
      adresse: analysis.adresse ?? null,
    });
    if (matched) clientId = matched.id;
  }

  // Update intervention
  setPhase('update_intervention');
  const patch: Record<string, unknown> = {
    particulier_contact: nextPc,
    organisation_id: organisationId,
    client_id: clientId,
    delegue_id: delegueId,
    acp_id: acpId,
    updated_at: new Date().toISOString(),
  };
  if (analysis.adresse) patch.adresse = analysis.adresse;
  if (analysis.type_probleme && (ALLOWED_TYPES as readonly string[]).includes(analysis.type_probleme)) {
    patch.type = analysis.type_probleme;
  }
  if (analysis.priorite) patch.priorite = analysis.priorite;
  // Description : description_precise > resume (le nouveau prompt FoxO
  // remplit description_precise avec un texte plus contextuel que resume).
  const newDescription = analysis.description_precise ?? analysis.resume;
  if (newDescription) patch.description = newDescription;
  if (analysis.reference_externe) patch.reference_externe = analysis.reference_externe;
  // action_requise → notes_tech (la migration 2026-05-19 doit être
  // appliquée pour que ça persiste, sinon le retry strippe la colonne).
  if (analysis.action_requise) {
    patch.notes_tech = `[IA action requise] ${analysis.action_requise}`;
  }

  const { error: updErr } = await admin.from('interventions').update(patch).eq('id', id);
  if (updErr) {
    console.error('[apply-reanalysis] update error', {
      intervention_id: id,
      code: (updErr as { code?: string }).code ?? null,
      message: updErr.message,
      details: (updErr as { details?: string }).details ?? null,
      hint: (updErr as { hint?: string }).hint ?? null,
      patch_keys: Object.keys(patch),
    });
    // Si une colonne manque (migration pending), on retire les champs
    // optionnels et on retente.
    const code = (updErr as { code?: string }).code;
    const colMissing = code === '42703' || /column .* does not exist/i.test(updErr.message);
    if (colMissing) {
      const safePatch: Record<string, unknown> = { updated_at: patch.updated_at };
      // Garde uniquement les champs qui existent depuis longtemps en DB
      const safeKeys = ['type', 'description', 'priorite', 'adresse', 'particulier_contact'];
      for (const k of safeKeys) {
        if (k in patch) safePatch[k] = patch[k];
      }
      console.warn('[apply-reanalysis] retry with safe patch', { keys: Object.keys(safePatch) });
      const { error: retryErr } = await admin.from('interventions').update(safePatch).eq('id', id);
      if (retryErr) {
        console.error('[apply-reanalysis] retry failed', retryErr);
        return NextResponse.json({ ok: false, error: retryErr.message }, { status: 500 });
      }
      // OK, mais signale qu'une migration est pending
      console.warn('[apply-reanalysis] partial update — apply migration 2026-05-12_intervention_demandeur_links.sql for full update');
    } else {
      return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
    }
  }

  // Insert des occupants extraits par Claude.
  //
  // Filtre permissif : on accepte tout occupant qui a AU MOINS un nom
  // OU un appartement défini. Avant on exigeait un email — on perdait
  // alors les occupants identifiés dans le corps du mail mais sans
  // adresse en CC (cas typique : "appartement K09 (Mme Vlasselaer)").
  //
  // Dédup intelligent : on construit des Sets sur (email, appartement,
  // nom) déjà présents pour cette intervention, et on skip si AU MOINS
  // une de ces clés matche — pas de doublon mais on garde la souplesse
  // du nouveau filtre.
  setPhase('insert_occupants');
  let newOccupantsCount = 0;
  const incomingOccupants = Array.isArray(analysis.occupants) ? analysis.occupants : [];
  if (incomingOccupants.length > 0) {
    const { data: existing } = await admin
      .from('occupants')
      .select('email, appartement, nom')
      .eq('intervention_id', id);
    type ExistingRow = { email: string | null; appartement: string | null; nom: string | null };
    const existingRows = (existing ?? []) as ExistingRow[];
    const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().trim();
    const existingEmails = new Set(existingRows.map((o) => norm(o.email)).filter(Boolean));
    const existingApts = new Set(existingRows.map((o) => norm(o.appartement)).filter(Boolean));
    const existingNoms = new Set(existingRows.map((o) => norm(o.nom)).filter(Boolean));

    const candidates = incomingOccupants.filter((o) => Boolean(o.nom || o.appartement));
    const dropped = incomingOccupants.length - candidates.length;
    const toInsert: OccupantInsertRow[] = [];
    let skippedDup = 0;
    for (const o of candidates) {
      const ek = norm(o.email);
      const ak = norm(o.appartement);
      const nk = norm(o.nom);
      const isDup = (ek && existingEmails.has(ek))
        || (ak && existingApts.has(ak))
        || (nk && existingNoms.has(nk));
      if (isDup) { skippedDup++; continue; }
      const instructions = o.notes
        ? `[extrait du mail] ${o.notes}`
        : '[extrait du mail]';
      toInsert.push({
        intervention_id: id,
        appartement: o.appartement || null,
        etage: o.etage || null,
        prenom: o.prenom || null,
        nom: o.nom || (o.type === 'parties_communes' ? 'Parties communes' : null),
        email: o.email || null,
        telephone: o.telephone || null,
        conf: 'en_attente' as const,
        contact_preference: o.email ? 'email' : (o.telephone ? 'sms' : 'email'),
        instructions,
        type_occupant: o.type,
      });
    }
    console.error('[apply-reanalysis] occupants triage', {
      received: incomingOccupants.length,
      dropped_no_name_no_apt: dropped,
      skipped_dup: skippedDup,
      to_insert: toInsert.length,
    });
    if (toInsert.length > 0) {
      console.error('[apply-reanalysis] calling safeInsertOccupants',
        toInsert.map((o) => ({ apt: o.appartement, nom: o.nom, email: o.email, type: o.type_occupant })));
      const insertResult = await safeInsertOccupants(toInsert);
      console.error('[apply-reanalysis] safeInsertOccupants result', insertResult);
      if (insertResult.ok) {
        newOccupantsCount = insertResult.inserted;
      } else {
        // L'insert a vraiment échoué — on remonte l'info au client pour
        // que le drawer affiche l'erreur au lieu de prétendre que tout
        // est ok. L'intervention est déjà mise à jour, donc on garde le
        // 200 mais on ajoute occupants_error dans la réponse.
        return NextResponse.json({
          ok: true,
          new_occupants_count: 0,
          occupants_error: insertResult.error,
          occupants_error_code: insertResult.code,
          occupants_error_details: insertResult.details,
          occupants_error_hint: insertResult.hint,
          occupants_stripped_columns: insertResult.stripped_columns,
          organisation_id: organisationId,
          client_id: clientId,
        });
      }
    }
  } else {
    console.error('[apply-reanalysis] no occupants in body — analysis.occupants is empty/null');
  }

  // Timeline
  setPhase('timeline');
  try {
    await admin.from('intervention_timeline').insert({
      intervention_id: id,
      type: 'mail_reanalyse',
      message: `Mail réanalysé par IA — ${newOccupantsCount} nouveau(x) occupant(s) ajouté(s)`,
      payload: { analysis, new_occupants_count: newOccupantsCount },
      created_by: user.email ?? 'admin',
    });
  } catch { /* noop — timeline best-effort */ }

  return NextResponse.json({
    ok: true,
    new_occupants_count: newOccupantsCount,
    organisation_id: organisationId,
    client_id: clientId,
  });
}
