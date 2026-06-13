// Phase 4 U3a — Helper d'écriture réutilisable : confirme un occupant suite à
// une réponse reçue par MAIL (et non plus seulement via le lien public /o/...).
//
// Contrairement au reste de la Phase 4 (lecture seule / pur), CE module ÉCRIT.
// Il est volontairement isolé et IDEMPOTENT pour rester le seul point d'entrée
// d'une confirmation « par mail », réutilisable par l'auto-confirm (U3b) comme
// par une future action admin manuelle (U4).
//
// Garde-fous :
//   - Ne réécrase JAMAIS un statut déjà tranché : si conf ∉ {null,'en_attente'}
//     (donc 'confirme' ou 'decline' déjà posé), on n'écrit RIEN.
//   - Miroir EXACT des colonnes écrites par src/app/o/actions.ts à la
//     confirmation occupant (conf, confirmed_at, proposed_creneau_*,
//     response_note) — ni plus, ni moins.
//   - Journalise dans intervention_timeline (traçabilité « quel mail a confirmé
//     quel occupant » via payload). L'insert occupant_responses_log mire celui
//     de o/actions.ts, en best-effort interne.
//   - Peut LEVER en cas d'erreur DB sur la mutation critique (update occupant /
//     timeline) : l'APPELANT est responsable du try/catch best-effort.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReponseOccupantIntention } from '@/app/admin/mails/MailAnalyseTypes';

export interface ConfirmFromMailParams {
  occupantId: string;
  threadId: string;                 // mail source (traçabilité)
  intention: ReponseOccupantIntention;
  raison: string;                   // issu du moteur de matching U2
  source: 'mail_auto' | 'mail_admin';
  actorId: string | null;          // admin déclencheur (created_by timeline) ; null accepté (colonne nullable)
}

export interface ConfirmFromMailResult {
  applied: boolean;
  skippedReason?: 'deja_traite' | 'occupant_introuvable';
}

// Statuts à partir desquels une confirmation par mail est autorisée. Tout autre
// statut ('confirme', 'decline') a déjà été tranché → on ne touche à rien.
const CONFIRMABLE_CONF = new Set([null, 'en_attente']);

export async function confirmOccupantFromMail(
  admin: SupabaseClient,
  params: ConfirmFromMailParams,
): Promise<ConfirmFromMailResult> {
  const { occupantId, threadId, intention, raison, source, actorId } = params;

  // 1. Lecture de l'occupant (statut + dossier). maybeSingle : pas d'erreur si
  //    introuvable.
  const { data: occ, error: readErr } = await admin
    .from('occupants')
    .select('id, conf, intervention_id')
    .eq('id', occupantId)
    .maybeSingle();
  if (readErr) throw new Error(`lecture occupant: ${readErr.message}`);
  if (!occ) return { applied: false, skippedReason: 'occupant_introuvable' };

  const occRow = occ as { id: string; conf: string | null; intervention_id: string };

  // 2. Idempotence : ne réécrase jamais un statut déjà tranché.
  if (!CONFIRMABLE_CONF.has(occRow.conf)) {
    return { applied: false, skippedReason: 'deja_traite' };
  }

  // 3. Mutation critique — miroir EXACT des colonnes écrites par o/actions.ts à
  //    la confirmation (pas de note occupant côté mail → response_note=null).
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
    .eq('id', occupantId);
  if (updateErr) throw new Error(`update occupant: ${updateErr.message}`);

  // 4. Journalisation timeline (trace mail↔occupant dans payload). Erreur DB →
  //    levée, avalée par le try/catch best-effort de l'appelant.
  const { error: timelineErr } = await admin
    .from('intervention_timeline')
    .insert({
      intervention_id: occRow.intervention_id,
      type: 'occupant_confirme',
      message: `Occupant confirmé depuis un mail — ${raison}`,
      payload: { occupant_id: occupantId, thread_id: threadId, intention, raison, source },
      created_by: actorId,
    });
  if (timelineErr) throw new Error(`timeline insert: ${timelineErr.message}`);

  // 5. Miroir de l'insert occupant_responses_log de o/actions.ts (best-effort
  //    interne : ne fait jamais échouer une confirmation déjà appliquée).
  //    reponse='confirme' : valeur du CHECK alignée sur la mutation réelle.
  try {
    const { error: logErr } = await admin
      .from('occupant_responses_log')
      .insert({
        occupant_id: occupantId,
        intervention_id: occRow.intervention_id,
        reponse: 'confirme',
        proposed_creneau_debut: null,
        proposed_creneau_fin: null,
        note: null,
      });
    if (logErr) {
      console.warn('[confirmOccupantFromMail] responses_log insert skipped:', logErr.message);
    }
  } catch (e) {
    console.warn('[confirmOccupantFromMail] responses_log insert threw:', e);
  }

  return { applied: true };
}
