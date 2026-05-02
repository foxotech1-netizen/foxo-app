'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { notifySyndicOccupantResponse } from '@/lib/email/notify-syndic-response';

export type Reponse = 'confirme' | 'decline' | 'counter';

export type RespondPayload = {
  reponse: Reponse;
  proposed_debut?: string;   // ISO 8601, requis si reponse === 'counter'
  proposed_fin?: string;     // ISO 8601, requis si reponse === 'counter'
  note?: string;             // commentaire libre, optionnel pour les 3 cas
};

export type ActionResult = { ok: true } | { ok: false; error: string };

const STATUTS_ACCEPTANT_REPONSE = [
  'nouvelle',
  'attente',
  'confirmee',
];

// Met à jour la réponse d'un occupant. Public — pas d'auth applicative.
// L'identification se fait par le confirmation_token dans l'URL
// (16 bytes hex = 128 bits d'entropie, non énumérable). Service-role
// obligatoire car RLS bloque les anonymes sur la table occupants.
const TOKEN_TTL_DAYS = 30;
const NOTE_MAX_LENGTH = 500;
const COUNTER_WINDOW_DAYS_MAX = 60;

function isValidIso(value: string): boolean {
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

export async function respondAsOccupant(
  token: string,
  payload: RespondPayload,
): Promise<ActionResult> {
  // ── 1. Validation du payload ────────────────────────────────────────
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'Réponse invalide.' };
  }
  const { reponse } = payload;
  if (reponse !== 'confirme' && reponse !== 'decline' && reponse !== 'counter') {
    return { ok: false, error: 'Réponse invalide.' };
  }

  let proposedDebut: string | null = null;
  let proposedFin: string | null = null;

  if (reponse === 'counter') {
    if (!payload.proposed_debut || !payload.proposed_fin) {
      return { ok: false, error: 'Veuillez indiquer un créneau de début et de fin.' };
    }
    if (!isValidIso(payload.proposed_debut) || !isValidIso(payload.proposed_fin)) {
      return { ok: false, error: 'Les dates proposées sont invalides.' };
    }
    const tDebut = new Date(payload.proposed_debut).getTime();
    const tFin = new Date(payload.proposed_fin).getTime();
    if (tDebut <= Date.now()) {
      return { ok: false, error: 'Le début proposé doit être dans le futur.' };
    }
    if (tFin <= tDebut) {
      return { ok: false, error: 'La fin doit être postérieure au début.' };
    }
    if (tDebut - Date.now() > COUNTER_WINDOW_DAYS_MAX * 24 * 60 * 60 * 1000) {
      return { ok: false, error: `Le créneau proposé doit rester dans les ${COUNTER_WINDOW_DAYS_MAX} prochains jours.` };
    }
    proposedDebut = new Date(payload.proposed_debut).toISOString();
    proposedFin = new Date(payload.proposed_fin).toISOString();
  }

  let note: string | null = null;
  if (typeof payload.note === 'string') {
    const trimmed = payload.note.trim();
    if (trimmed.length > NOTE_MAX_LENGTH) {
      return { ok: false, error: `Le commentaire est trop long (max ${NOTE_MAX_LENGTH} caractères).` };
    }
    note = trimmed.length > 0 ? trimmed : null;
  }

  // ── 2. Lookup occupant + TTL ────────────────────────────────────────
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: 'Configuration serveur incomplète.' };
  }

  const { data: occ } = await admin
    .from('occupants')
    .select('id, intervention_id, token_sent_at')
    .eq('confirmation_token', token)
    .maybeSingle();

  if (!occ) return { ok: false, error: 'Lien invalide ou expiré.' };

  const sentAt = occ.token_sent_at ? new Date(occ.token_sent_at).getTime() : null;
  if (!sentAt || Date.now() - sentAt > TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000) {
    return { ok: false, error: 'Lien invalide ou expiré.' };
  }

  // ── 3. Lookup intervention ──────────────────────────────────────────
  const { data: iv } = await admin
    .from('interventions')
    .select('statut')
    .eq('id', occ.intervention_id)
    .maybeSingle();

  if (!iv) return { ok: false, error: 'Intervention introuvable.' };
  if (!STATUTS_ACCEPTANT_REPONSE.includes(iv.statut)) {
    return { ok: false, error: 'L\'intervention n\'accepte plus de modification de présence.' };
  }

  // ── 4. UPDATE occupants selon le type de réponse ────────────────────
  const nowIso = new Date().toISOString();
  let updatePatch: Record<string, unknown>;
  if (reponse === 'confirme') {
    updatePatch = {
      conf: 'confirme',
      confirmed_at: nowIso,
      proposed_creneau_debut: null,
      proposed_creneau_fin: null,
      response_note: note,
    };
  } else if (reponse === 'decline') {
    updatePatch = {
      conf: 'decline',
      confirmed_at: nowIso,
      proposed_creneau_debut: null,
      proposed_creneau_fin: null,
      response_note: note,
    };
  } else {
    // counter — la contre-proposition doit être validée par le syndic.
    // On garde donc conf='en_attente' et on stocke le créneau proposé.
    updatePatch = {
      conf: 'en_attente',
      confirmed_at: nowIso,
      proposed_creneau_debut: proposedDebut,
      proposed_creneau_fin: proposedFin,
      response_note: note,
    };
  }

  const { error: updateError } = await admin
    .from('occupants')
    .update(updatePatch)
    .eq('id', occ.id);

  if (updateError) return { ok: false, error: updateError.message };

  // ── 5. Log dans occupant_responses_log (best-effort) ────────────────
  const { error: logError } = await admin
    .from('occupant_responses_log')
    .insert({
      occupant_id: occ.id,
      intervention_id: occ.intervention_id,
      reponse,
      proposed_creneau_debut: proposedDebut,
      proposed_creneau_fin: proposedFin,
      note,
    });
  if (logError) {
    console.warn('[respondAsOccupant] log insert failed:', logError.message);
  }

  // ── 6. Notif syndic (best-effort, ne fait jamais échouer l'action) ──
  try {
    await notifySyndicOccupantResponse({
      interventionId: occ.intervention_id,
      occupantId: occ.id,
      reponse,
      proposedDebut,
      proposedFin,
      note,
    });
  } catch (e) {
    console.warn('[respondAsOccupant] notifySyndicOccupantResponse threw:', e);
  }

  // ── 7. Revalidate + retour ──────────────────────────────────────────
  revalidatePath(`/o/${token}`);
  return { ok: true };
}
