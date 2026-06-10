import { createClient } from '@/lib/supabase/server';
import type { Organisation, DelegueRole } from '@/lib/types/database';

// Identifie l'organisation associée à l'utilisateur connecté.
//
// Stratégie (en cascade) :
//   1. Lookup dans `delegues` par email (actif=true) — supporte
//      plusieurs orgs ; on prend la première.
//   2. Fallback : match legacy `organisations.email = email`
//      (rétro-compat avec les comptes existants avant l'introduction
//      de la table delegues).
//
// Retourne null si aucun match → le portail affiche "accès refusé".
export async function getCurrentSyndic(): Promise<{
  user: { email: string | null };
  org: Organisation | null;
  role: DelegueRole | null;        // null si match legacy (pas de rôle)
  via: 'delegue' | 'legacy' | null;
} | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const email = (user.email ?? '').toLowerCase();
  if (!email) return { user: { email: null }, org: null, role: null, via: null };

  // 1. Tentative via delegues (jointure inline)
  const { data: del } = await supabase
    .from('delegues')
    .select('role, actif, organisation_id, organisation:organisations(*)')
    .ilike('email', email)
    .eq('actif', true)
    .limit(1)
    .maybeSingle();
  if (del) {
    const row = del as unknown as {
      role: DelegueRole;
      organisation: Organisation | Organisation[] | null;
    };
    const org = Array.isArray(row.organisation) ? (row.organisation[0] ?? null) : row.organisation;
    if (org) {
      return {
        user: { email: user.email ?? null },
        org,
        role: row.role,
        via: 'delegue',
      };
    }
  }

  // 2. Fallback legacy
  const { data: org } = await supabase
    .from('organisations')
    .select('*')
    .ilike('email', email)
    .maybeSingle();

  return {
    user: { email: user.email ?? null },
    org: (org as Organisation | null) ?? null,
    role: null,
    via: org ? 'legacy' : null,
  };
}

// Interventions sur lesquelles l'organisation est mandatée via un dossier
// sinistre (dossiers_sinistres.courtier_id = org.id). Couvre courtier ET
// expert : les deux rôles écrivent leur mandat dans la colonne courtier_id
// (cf. portal/actions.submitRequest). Sert à étendre la visibilité du portail
// au-delà du lien direct syndic_id/organisation_id (audit cohérence #19).
//
// Le client est passé par l'appelant (cookie-bound RLS-applied) pour ne pas
// ouvrir une seconde connexion. Retourne une liste d'ids dédupliquée.
export async function getMandatedInterventionIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from('dossiers_sinistres')
    .select('intervention_id')
    .eq('courtier_id', orgId);
  const ids = ((data ?? []) as { intervention_id: string }[]).map((d) => d.intervention_id);
  return Array.from(new Set(ids));
}
