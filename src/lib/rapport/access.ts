import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';
import type { StatutIntervention } from '@/lib/types/database';

// Statuts qui rendent le rapport "publié" — visible par les non-staff.
const STATUTS_RAPPORT_PUBLIE: StatutIntervention[] = ['rapport_disponible', 'cloturee', 'facturee'];

export type AccessResult =
  | { ok: true; statut: StatutIntervention; via: 'admin' | 'tech' | 'partner' | 'occupant' }
  | { ok: false; status: number; error: string };

// Vérifie qu'un caller (admin, tech, partner ou occupant) a le droit de
// télécharger le rapport d'une intervention.
//
// - admin : autorisé pour toute intervention, tout statut
// - tech  : seulement ses propres interventions, tout statut
// - partner (syndic ou courtier) : interventions appartenant à son
//     organisation (syndic_id == org.id), uniquement si statut publié
// - occupant : passé via param `occupantId`, vérification que l'occupant
//     appartient à cette intervention, uniquement si statut publié
//
// TODO : ajouter le chemin "courtier via dossier_sinistre" quand on aura
// précisé le schéma de la table dossiers_sinistres (colonnes courtier_id /
// intervention_id).
export async function checkRapportAccess(
  interventionId: string,
  opts: { occupantId?: string | null },
): Promise<AccessResult> {
  const supabase = await createClient();

  // Charge le statut une fois — on s'en sert pour les checks "publié"
  const { data: iv, error: ivErr } = await supabase
    .from('interventions')
    .select('id, statut, syndic_id, technicien_id')
    .eq('id', interventionId)
    .maybeSingle();

  if (ivErr || !iv) return { ok: false, status: 404, error: 'Intervention introuvable.' };
  const statut = iv.statut as StatutIntervention;
  const isPublished = STATUTS_RAPPORT_PUBLIE.includes(statut);

  // Voie occupant — pas de session
  if (opts.occupantId) {
    const { data: occ } = await supabase
      .from('occupants')
      .select('id, intervention_id')
      .eq('id', opts.occupantId)
      .maybeSingle();
    if (!occ || occ.intervention_id !== interventionId) {
      return { ok: false, status: 403, error: 'Lien invalide.' };
    }
    if (!isPublished) {
      return { ok: false, status: 404, error: 'Rapport pas encore disponible.' };
    }
    return { ok: true, statut, via: 'occupant' };
  }

  // Voies authentifiées
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, error: 'Authentification requise.' };

  const role = roleForEmail(user.email);

  if (role === 'admin') {
    return { ok: true, statut, via: 'admin' };
  }

  if (role === 'tech') {
    const { data: u } = await supabase
      .from('utilisateurs')
      .select('id')
      .eq('email', (user.email ?? '').toLowerCase())
      .maybeSingle();
    if (!u || iv.technicien_id !== u.id) {
      return { ok: false, status: 403, error: 'Accès refusé.' };
    }
    return { ok: true, statut, via: 'tech' };
  }

  // partner : syndic ou courtier
  const { data: org } = await supabase
    .from('organisations')
    .select('id, type')
    .eq('email', (user.email ?? '').toLowerCase())
    .maybeSingle();
  if (!org) return { ok: false, status: 403, error: 'Compte non lié.' };

  if (iv.syndic_id !== org.id) {
    // Voie courtier : intervention liée via dossier sinistre.
    // dossiers_sinistres(courtier_id FK → organisations, intervention_id FK → interventions)
    if (org.type !== 'courtier') {
      return { ok: false, status: 403, error: 'Accès refusé.' };
    }
    const { data: dossier } = await supabase
      .from('dossiers_sinistres')
      .select('id')
      .eq('intervention_id', interventionId)
      .eq('courtier_id', org.id)
      .maybeSingle();
    if (!dossier) {
      return { ok: false, status: 403, error: 'Accès refusé.' };
    }
  }

  if (!isPublished) {
    return { ok: false, status: 404, error: 'Rapport pas encore disponible.' };
  }
  return { ok: true, statut, via: 'partner' };
}
