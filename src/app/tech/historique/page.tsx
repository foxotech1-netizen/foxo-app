import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Acp, Intervention, Organisation } from '@/lib/types/database';
import { HistoriqueClient, type MissionRow } from './HistoriqueClient';

export const dynamic = 'force-dynamic';

export default async function TechHistoriquePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  // Compte applicatif lié au tech
  const { data: u } = await supabase
    .from('utilisateurs')
    .select('id, prenom, nom')
    .eq('email', (user.email ?? '').toLowerCase())
    .maybeSingle();
  if (!u) {
    return (
      <div
        className="bg-[var(--color-cream)] rounded-xl p-6 text-center"
        style={{ boxShadow: '0 1px 2px rgba(15,32,64,0.04), 0 4px 12px rgba(15,32,64,0.05), 0 0 0 1px rgba(15,32,64,0.04)' }}
      >
        <h1 className="font-sora text-[20px] font-semibold text-[var(--color-ink)] mb-2">Compte non trouvé</h1>
        <p className="text-[14px] text-[var(--color-ink-mid)]">Contacte l&apos;administrateur.</p>
      </div>
    );
  }

  // Toutes les interventions du tech, du plus récent au plus ancien
  const { data: ivs } = await supabase
    .from('interventions')
    .select('id, ref, statut, priorite, type, creneau_debut, started_at, ended_at, updated_at, acp_id, syndic_id, adresse, particulier_contact')
    .eq('technicien_id', u.id)
    .order('creneau_debut', { ascending: false, nullsFirst: false });
  const interventions = (ivs ?? []) as Pick<
    Intervention,
    'id' | 'ref' | 'statut' | 'priorite' | 'type' | 'creneau_debut' | 'started_at' | 'ended_at' | 'updated_at' | 'acp_id' | 'syndic_id' | 'adresse' | 'particulier_contact'
  >[];

  // Joins ACP + syndic (lite)
  const acpIds = Array.from(new Set(interventions.map((i) => i.acp_id).filter(Boolean) as string[]));
  const syndicIds = Array.from(new Set(interventions.map((i) => i.syndic_id).filter(Boolean) as string[]));
  const [acpRes, orgRes] = await Promise.all([
    acpIds.length > 0
      ? supabase.from('acps').select('id, nom, adresse, ville').in('id', acpIds)
      : Promise.resolve({ data: [] as Pick<Acp, 'id' | 'nom' | 'adresse' | 'ville'>[] }),
    syndicIds.length > 0
      ? supabase.from('organisations').select('id, nom').in('id', syndicIds)
      : Promise.resolve({ data: [] as Pick<Organisation, 'id' | 'nom'>[] }),
  ]);
  const acpMap = new Map(((acpRes.data ?? []) as Pick<Acp, 'id' | 'nom' | 'adresse' | 'ville'>[]).map((a) => [a.id, a]));
  const orgMap = new Map(((orgRes.data ?? []) as Pick<Organisation, 'id' | 'nom'>[]).map((o) => [o.id, o.nom]));

  // Photo counts par intervention (table photos_interventions)
  const ivIds = interventions.map((i) => i.id);
  let photoCountById = new Map<string, number>();
  let rapportIvIds = new Set<string>();
  if (ivIds.length > 0) {
    const { data: photoRows } = await supabase
      .from('photos_interventions')
      .select('intervention_id')
      .in('intervention_id', ivIds);
    for (const r of (photoRows ?? []) as { intervention_id: string }[]) {
      photoCountById.set(r.intervention_id, (photoCountById.get(r.intervention_id) ?? 0) + 1);
    }
    const { data: rapRows } = await supabase
      .from('rapports')
      .select('intervention_id')
      .in('intervention_id', ivIds);
    rapportIvIds = new Set(((rapRows ?? []) as { intervention_id: string }[]).map((r) => r.intervention_id));
  }

  const rows: MissionRow[] = interventions.map((iv) => {
    const acp = iv.acp_id ? acpMap.get(iv.acp_id) ?? null : null;
    const pc = iv.particulier_contact;
    const clientName = acp?.nom
      ?? (pc ? [pc.prenom, pc.nom].filter(Boolean).join(' ').trim() || null : null);
    return {
      id: iv.id,
      ref: iv.ref,
      statut: iv.statut,
      priorite: iv.priorite,
      type: iv.type,
      creneau_debut: iv.creneau_debut,
      ended_at: iv.ended_at,
      updated_at: iv.updated_at,
      adresse: iv.adresse,
      acp_nom: acp?.nom ?? null,
      acp_ville: acp?.ville ?? null,
      syndic_nom: iv.syndic_id ? orgMap.get(iv.syndic_id) ?? null : null,
      client_label: clientName ?? '—',
      photo_count: photoCountById.get(iv.id) ?? 0,
      has_rapport: rapportIvIds.has(iv.id),
    };
  });

  return <HistoriqueClient rows={rows} />;
}
