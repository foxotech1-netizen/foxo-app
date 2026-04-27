import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { roleForEmail } from '@/lib/auth/roles';
import type { StatutIntervention } from '@/lib/types/database';

// Statuts qui rendent le rapport "publié" — visible par les non-staff.
const STATUTS_RAPPORT_PUBLIE: StatutIntervention[] = ['rapport', 'cloturee'];

export type AccessResult =
  | { ok: true; statut: StatutIntervention; via: 'admin' | 'tech' | 'partner' | 'occupant' }
  | { ok: false; status: number; error: string };

// Vérifie qu'un caller (admin, tech, partner ou occupant) a le droit de
// télécharger le rapport d'une intervention.
//
// - admin : autorisé pour toute intervention, tout statut
// - tech  : seulement ses propres interventions, tout statut
// - partner syndic : interventions appartenant à son org (syndic_id == org.id),
//     uniquement si statut publié
// - partner courtier : direct via syndic_id OU indirect via dossiers_sinistres
//     (courtier_id == org.id), uniquement si statut publié
// - occupant : passé via param `occupantId`, vérification que l'occupant
//     appartient à cette intervention, uniquement si statut publié
//     (bypass RLS via service-role car pas de session)
export async function checkRapportAccess(
  interventionId: string,
  opts: { occupantId?: string | null },
): Promise<AccessResult> {
  // Voie occupant : pas de session — service-role nécessaire pour bypass RLS.
  // L'autorisation se fait par UUID v4 dans l'URL.
  if (opts.occupantId) {
    let admin;
    try {
      admin = createAdminClient();
    } catch {
      return { ok: false, status: 500, error: 'Configuration serveur incomplète.' };
    }

    const { data: iv } = await admin
      .from('interventions')
      .select('id, statut')
      .eq('id', interventionId)
      .maybeSingle();
    if (!iv) return { ok: false, status: 404, error: 'Intervention introuvable.' };
    const statut = iv.statut as StatutIntervention;
    const isPublished = STATUTS_RAPPORT_PUBLIE.includes(statut);

    const { data: occ } = await admin
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

  // Voies authentifiées — RLS scopera selon les policies.
  const supabase = await createClient();

  const { data: iv, error: ivErr } = await supabase
    .from('interventions')
    .select('id, statut, syndic_id, technicien_id')
    .eq('id', interventionId)
    .maybeSingle();

  if (ivErr || !iv) return { ok: false, status: 404, error: 'Intervention introuvable.' };
  const statut = iv.statut as StatutIntervention;
  const isPublished = STATUTS_RAPPORT_PUBLIE.includes(statut);

  // Voie occupant déjà gérée plus haut. Code mort ici mais préserve la
  // structure existante au cas où l'opts.occupantId est passé en plus
  // d'une session (cas pathologique).
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
