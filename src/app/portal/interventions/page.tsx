import { createClient } from '@/lib/supabase/server';
import { getCurrentSyndic } from '@/lib/portal/syndic';
import { InterventionsListClient } from './InterventionsListClient';
import type { Acp, Intervention } from '@/lib/types/database';

export const dynamic = 'force-dynamic';

export type InterventionListItem = Pick<
  Intervention,
  'id' | 'ref' | 'statut' | 'priorite' | 'type' | 'description' | 'creneau_debut' | 'updated_at' | 'created_at' | 'acp_id' | 'adresse'
> & {
  // acp_nom : nom de l'ACP (syndic) OU nom de l'assuré (courtier)
  acp_nom: string | null;
  // ref_courtier : référence interne du courtier (vide pour syndic)
  ref_courtier: string | null;
};

type DossierLite = { intervention_id: string; assure: string | null; ref_courtier: string | null };

export default async function InterventionsPage({
  searchParams,
}: {
  searchParams: Promise<{ statut?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const session = await getCurrentSyndic();
  if (!session) return null;
  const { user, org } = session;

  if (!org) {
    return (
      <div className="bg-cream border border-sand-border rounded-2xl p-8 text-center">
        <h1 className="text-xl font-extrabold text-ink mb-2">Compte non lié</h1>
        <p className="text-sm text-ink-mid">
          {user.email} n&apos;est pas associé à un partenaire. Contactez{' '}
          <a href="mailto:info@foxo.be" className="text-navy underline">info@foxo.be</a>.
        </p>
      </div>
    );
  }

  const isCourtier = org.type === 'courtier';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('interventions')
    .select('id, ref, statut, priorite, type, description, creneau_debut, updated_at, created_at, acp_id, adresse')
    .eq('syndic_id', org.id)
    .order('created_at', { ascending: false });

  const interventions: Intervention[] = (data as Intervention[] | null) ?? [];

  // Charge ACPs (mode syndic) ou dossiers_sinistres (mode courtier)
  let acpMap = new Map<string, string>();
  let dossierMap = new Map<string, DossierLite>();

  if (isCourtier) {
    const ivIds = interventions.map((i) => i.id);
    if (ivIds.length > 0) {
      const { data: dossiers } = await supabase
        .from('dossiers_sinistres')
        .select('intervention_id, assure, ref_courtier')
        .in('intervention_id', ivIds);
      dossierMap = new Map(
        ((dossiers ?? []) as DossierLite[]).map((d) => [d.intervention_id, d]),
      );
    }
  } else {
    const acpIds = Array.from(new Set(interventions.map((i) => i.acp_id).filter(Boolean) as string[]));
    if (acpIds.length > 0) {
      const { data: acps } = await supabase
        .from('acps')
        .select('id, nom')
        .in('id', acpIds);
      acpMap = new Map(((acps ?? []) as Pick<Acp, 'id' | 'nom'>[]).map((a) => [a.id, a.nom]));
    }
  }

  const items: InterventionListItem[] = interventions.map((iv) => {
    const dossier = isCourtier ? dossierMap.get(iv.id) ?? null : null;
    return {
      id: iv.id,
      ref: iv.ref,
      statut: iv.statut,
      priorite: iv.priorite,
      type: iv.type,
      description: iv.description,
      creneau_debut: iv.creneau_debut,
      updated_at: iv.updated_at,
      created_at: iv.created_at,
      acp_id: iv.acp_id,
      adresse: iv.adresse,
      acp_nom: isCourtier
        ? (dossier?.assure ?? null)
        : (iv.acp_id ? (acpMap.get(iv.acp_id) ?? null) : null),
      ref_courtier: dossier?.ref_courtier ?? null,
    };
  });

  return (
    <InterventionsListClient
      items={items}
      initialStatut={sp.statut ?? 'tous'}
      initialQuery={sp.q ?? ''}
      loadError={error?.message ?? null}
    />
  );
}
