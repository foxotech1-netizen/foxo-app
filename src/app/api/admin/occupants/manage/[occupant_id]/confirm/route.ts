import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

// POST /api/admin/occupants/manage/[occupant_id]/confirm
//
// Confirme MANUELLEMENT la présence d'un occupant, quand celui-ci a confirmé par
// SMS ou par téléphone (hors du lien public /o/... et hors mail). Écrit EXACTEMENT
// les mêmes colonnes que la confirmation par lien (src/app/o/actions.ts) et par
// mail (src/lib/occupants/confirm-from-mail.ts).
//
// Volontairement SILENCIEUX : aucun email, aucun changement de statut du dossier.
// Idempotent : ne réécrase jamais un statut déjà tranché.
//
// Pourquoi une route dédiée plutôt que confirmOccupantFromMail : la signature de
// ce helper est spécifique au mail (threadId requis, source = 'mail_auto'|'mail_admin').
// La faire mentir pour un appel téléphonique corromprait la traçabilité. On
// reproduit donc le MÊME contrat de colonnes, en enregistrant la vérité
// (source 'manuel'), sans toucher au module mail.

// Statuts depuis lesquels une confirmation manuelle est autorisée. 'confirme' et
// 'decline' sont déjà tranchés -> no-op (aligné sur confirm-from-mail.ts).
const CONFIRMABLE_CONF = new Set([null, 'en_attente']);

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ occupant_id: string }> },
) {
  // 1. Auth (client cookie) — admin uniquement.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { occupant_id } = await params;

  const admin = createAdminClient();

  // 2. Lecture occupant (statut actuel + dossier parent).
  const { data: occ, error: readErr } = await admin
    .from('occupants')
    .select('id, conf, intervention_id')
    .eq('id', occupant_id)
    .maybeSingle();
  if (readErr) {
    return NextResponse.json({ ok: false, error: readErr.message }, { status: 500 });
  }
  if (!occ) {
    return NextResponse.json({ ok: false, error: 'Occupant introuvable.' }, { status: 404 });
  }
  const occRow = occ as { id: string; conf: string | null; intervention_id: string };

  // 3. Idempotence : déjà confirmé ou déjà refusé -> on ne touche à rien.
  if (!CONFIRMABLE_CONF.has(occRow.conf)) {
    return NextResponse.json({ ok: true, applied: false, reason: 'deja_tranche' });
  }

  // 4. Mutation — miroir EXACT de o/actions.ts / confirm-from-mail.ts.
  const nowIso = new Date().toISOString();
  const { error: updateErr } = await admin
    .from('occupants')
    .update({
      conf: 'confirme',
      confirmed_at: nowIso,
      proposed_creneau_debut: null,
      proposed_creneau_fin: null,
      response_note: null,
    })
    .eq('id', occupant_id);
  if (updateErr) {
    return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });
  }

  // 5. Timeline (best-effort : n'annule ni ne fait jamais échouer la confirmation).
  try {
    const { error: tlErr } = await admin
      .from('intervention_timeline')
      .insert({
        intervention_id: occRow.intervention_id,
        type: 'occupant_confirme',
        message: 'Occupant confirmé manuellement (SMS / appel)',
        payload: { occupant_id, source: 'manuel' },
        created_by: user.email ?? 'admin',
      });
    if (tlErr) console.warn('[occupant confirm manuel] timeline insert ignoré:', tlErr.message);
  } catch (e) {
    console.warn('[occupant confirm manuel] timeline insert threw:', e);
  }

  // 6. occupant_responses_log (best-effort : miroir confirm-from-mail.ts).
  try {
    const { error: logErr } = await admin
      .from('occupant_responses_log')
      .insert({
        occupant_id,
        intervention_id: occRow.intervention_id,
        reponse: 'confirme',
        proposed_creneau_debut: null,
        proposed_creneau_fin: null,
        note: null,
      });
    if (logErr) console.warn('[occupant confirm manuel] responses_log insert ignoré:', logErr.message);
  } catch (e) {
    console.warn('[occupant confirm manuel] responses_log insert threw:', e);
  }

  return NextResponse.json({ ok: true, applied: true });
}
