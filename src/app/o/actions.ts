'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';

export type Reponse = 'confirme' | 'decline';
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

export async function respondAsOccupant(
  token: string,
  reponse: Reponse,
): Promise<ActionResult> {
  if (reponse !== 'confirme' && reponse !== 'decline') {
    return { ok: false, error: 'Réponse invalide.' };
  }

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

  const { data: iv } = await admin
    .from('interventions')
    .select('statut')
    .eq('id', occ.intervention_id)
    .maybeSingle();

  if (!iv) return { ok: false, error: 'Intervention introuvable.' };
  if (!STATUTS_ACCEPTANT_REPONSE.includes(iv.statut)) {
    return { ok: false, error: 'L\'intervention n\'accepte plus de modification de présence.' };
  }

  const { error } = await admin
    .from('occupants')
    .update({ conf: reponse })
    .eq('id', occ.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/o/${token}`);
  return { ok: true };
}
