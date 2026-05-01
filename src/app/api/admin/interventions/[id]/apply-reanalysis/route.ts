import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { roleForEmail } from '@/lib/auth/roles';
import {
  matchOrCreateOrganisation,
  matchOrCreateClient,
  type CronMailAnalysis,
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
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { id } = await params;

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

  // Charge l'intervention
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

  const admin = createAdminClient();

  // Construction du nouveau particulier_contact (merge non-destructif)
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

  // Matching org/client (peut créer si nouveau)
  let organisationId: string | null = intervention.organisation_id;
  let clientId: string | null = intervention.client_id;
  if (analysis.type_demandeur === 'syndic' || analysis.type_demandeur === 'courtier') {
    const matched = await matchOrCreateOrganisation({
      type: analysis.type_demandeur,
      nomSociete: analysis.nom_societe,
      email: analysis.email ?? '',
      telephone: analysis.telephone ?? '',
    });
    if (matched) organisationId = matched.id;
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
  const patch: Record<string, unknown> = {
    particulier_contact: nextPc,
    organisation_id: organisationId,
    client_id: clientId,
    updated_at: new Date().toISOString(),
  };
  if (analysis.adresse) patch.adresse = analysis.adresse;
  if (analysis.type_probleme && (ALLOWED_TYPES as readonly string[]).includes(analysis.type_probleme)) {
    patch.type = analysis.type_probleme;
  }
  if (analysis.priorite) patch.priorite = analysis.priorite;
  if (analysis.resume) patch.description = analysis.resume;
  if (analysis.reference_externe) patch.reference_externe = analysis.reference_externe;

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

  // Ajoute uniquement les NOUVEAUX occupants (email pas déjà présent)
  let newOccupantsCount = 0;
  if (analysis.occupants && analysis.occupants.length > 0) {
    const { data: existing } = await admin
      .from('occupants')
      .select('email')
      .eq('intervention_id', id);
    const existingEmails = new Set(
      ((existing ?? []) as { email: string | null }[])
        .map((o) => (o.email ?? '').toLowerCase())
        .filter(Boolean),
    );
    // Charge aussi les apt existants pour dédupliquer les parties_communes
    // qui n'ont pas d'email mais un appartement unique
    const { data: existingApts } = await admin
      .from('occupants')
      .select('appartement')
      .eq('intervention_id', id);
    const existingAptKeys = new Set(
      ((existingApts ?? []) as { appartement: string | null }[])
        .map((o) => (o.appartement ?? '').toLowerCase().trim())
        .filter(Boolean),
    );
    const toInsert = analysis.occupants
      .filter((o) => {
        // parties_communes : autorisé sans email mais dédup sur apt
        if (o.type === 'parties_communes') {
          return Boolean(o.appartement) && !existingAptKeys.has(o.appartement.toLowerCase().trim());
        }
        // Autres : requiert email NON déjà présent
        return Boolean(o.email) && !existingEmails.has(o.email.toLowerCase());
      })
      .map((o) => {
        const instructions = o.notes
          ? `[extrait du mail] ${o.notes}`
          : '[extrait du mail]';
        return {
          intervention_id: id,
          appartement: o.appartement || null,
          prenom: o.prenom || null,
          nom: o.nom || (o.type === 'parties_communes' ? 'Parties communes' : null),
          email: o.email || null,
          telephone: o.telephone || null,
          conf: 'en_attente' as const,
          contact_preference: o.email ? 'email' : (o.telephone ? 'sms' : 'email'),
          instructions,
        };
      });
    if (toInsert.length > 0) {
      const { error: insErr } = await admin.from('occupants').insert(toInsert);
      if (!insErr) newOccupantsCount = toInsert.length;
    }
  }

  // Timeline
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
