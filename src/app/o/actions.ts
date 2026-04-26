'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type Reponse = 'confirme' | 'decline';
export type ActionResult = { ok: true } | { ok: false; error: string };

const STATUTS_ACCEPTANT_REPONSE = [
  'nouvelle',
  'date_proposee',
  'attente_confirmation',
  'confirmee',
];

// Met à jour la réponse d'un occupant. Public — pas d'auth requise.
// On ne se fie qu'à l'UUID v4 dans l'URL pour l'identification.
export async function respondAsOccupant(
  occupantId: string,
  reponse: Reponse,
): Promise<ActionResult> {
  if (reponse !== 'confirme' && reponse !== 'decline') {
    return { ok: false, error: 'Réponse invalide.' };
  }

  const supabase = await createClient();

  const { data: occ } = await supabase
    .from('occupants')
    .select('id, intervention_id')
    .eq('id', occupantId)
    .maybeSingle();

  if (!occ) return { ok: false, error: 'Lien invalide ou expiré.' };

  // Vérifier que l'intervention est encore dans une phase qui accepte les
  // confirmations. Au-delà (réalisée/clôturée), changer la réponse n'a plus de sens.
  const { data: iv } = await supabase
    .from('interventions')
    .select('statut')
    .eq('id', occ.intervention_id)
    .maybeSingle();

  if (!iv) return { ok: false, error: 'Intervention introuvable.' };
  if (!STATUTS_ACCEPTANT_REPONSE.includes(iv.statut)) {
    return { ok: false, error: 'L\'intervention n\'accepte plus de modification de présence.' };
  }

  const { error } = await supabase
    .from('occupants')
    .update({ conf: reponse })
    .eq('id', occupantId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/o/${occupantId}`);
  return { ok: true };
}
