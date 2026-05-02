import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { TECH_EMAILS } from '@/lib/auth/roles';
import type { Acp, Delegue, Intervention, Occupant, Organisation, Utilisateur, InterventionRow, CreneauDisponible } from '@/lib/types/database';
import { InterventionsClient } from '../../InterventionsClient';
import type { DashboardData, FreeSlot } from '../../page';

export const dynamic = 'force-dynamic';

type AcpLite = Pick<Acp, 'id' | 'nom' | 'adresse' | 'ville'>;

// Page complète d'une intervention. Réutilise <InterventionsClient> avec
// le flag `fullPage` qui masque la liste et étend le drawer en pleine
// largeur. Server-fetch les mêmes données que /admin pour que le drawer
// fonctionne à l'identique (techs, créneaux libres, occupants pending).
export default async function InterventionFullPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayISO = `${todayStart.getFullYear()}-${String(todayStart.getMonth() + 1).padStart(2, '0')}-${String(todayStart.getDate()).padStart(2, '0')}`;

  const [interventionsRes, acpsRes, orgsRes, usersRes, slotsRes, deleguesRes] = await Promise.all([
    supabase
      .from('interventions')
      .select('*')
      .order('created_at', { ascending: false }),
    supabase.from('acps').select('id,nom,adresse,ville'),
    supabase.from('organisations').select('id,nom,type,email'),
    supabase
      .from('utilisateurs')
      .select('id,prenom,nom,email,couleur')
      .in('email', TECH_EMAILS as unknown as string[])
      .order('prenom', { ascending: true }),
    supabase
      .from('creneaux_disponibles')
      .select('id, technicien_id, date, heure_debut, heure_fin')
      .eq('statut', 'libre')
      .gte('date', todayISO)
      .order('date', { ascending: true })
      .order('heure_debut', { ascending: true }),
    supabase.from('delegues').select('id, prenom, nom, email, telephone'),
  ]);

  const interventions: Intervention[] = interventionsRes.data ?? [];
  if (!interventions.some((iv) => iv.id === id)) notFound();

  const acps: AcpLite[] = (acpsRes.data as AcpLite[] | null) ?? [];
  const orgs: Pick<Organisation, 'id' | 'nom' | 'type' | 'email'>[] = orgsRes.data ?? [];
  const techs: Utilisateur[] = usersRes.data ?? [];
  const freeSlots: FreeSlot[] = (slotsRes.data ?? []) as FreeSlot[];
  type DelegueLite = Pick<Delegue, 'id' | 'prenom' | 'nom' | 'email' | 'telephone'>;
  const delegues: DelegueLite[] = (deleguesRes.data as DelegueLite[] | null) ?? [];

  const acpMap = new Map(acps.map((a) => [a.id, a]));
  const orgMap = new Map(orgs.map((o) => [o.id, o]));
  const techMap = new Map(techs.map((t) => [t.id, t]));
  const delegueMap = new Map(delegues.map((d) => [d.id, d]));

  const rows: InterventionRow[] = interventions.map((iv) => ({
    ...iv,
    acp: iv.acp_id ? (acpMap.get(iv.acp_id) ?? null) : null,
    syndic: iv.syndic_id
      ? (orgMap.get(iv.syndic_id) ?? null)
      : iv.organisation_id ? (orgMap.get(iv.organisation_id) ?? null) : null,
    technicien: iv.technicien_id ? (techMap.get(iv.technicien_id) ?? null) : null,
    delegue: iv.delegue_id ? (delegueMap.get(iv.delegue_id) ?? null) : null,
  }));

  const freeSlotsByTech: Record<string, FreeSlot[]> = {};
  for (const s of freeSlots) {
    if (!s.technicien_id) continue;
    if (!freeSlotsByTech[s.technicien_id]) freeSlotsByTech[s.technicien_id] = [];
    freeSlotsByTech[s.technicien_id].push(s);
  }

  // Occupants pending pour cette intervention (limité ici à elle seule)
  let occupantsPendingByIv: Record<string, Pick<Occupant, 'id' | 'appartement' | 'nom' | 'conf'>[]> = {};
  const occRes = await supabase
    .from('occupants')
    .select('id, intervention_id, appartement, nom, conf')
    .eq('intervention_id', id);
  const occs = (occRes.data ?? []) as (Pick<Occupant, 'id' | 'appartement' | 'nom' | 'conf'> & { intervention_id: string })[];
  for (const o of occs) {
    if (o.conf === 'confirme' || o.conf === 'decline') continue;
    if (!occupantsPendingByIv[o.intervention_id]) occupantsPendingByIv[o.intervention_id] = [];
    occupantsPendingByIv[o.intervention_id].push({ id: o.id, appartement: o.appartement, nom: o.nom, conf: o.conf });
  }

  const dashboard: DashboardData = { freeSlotsByTech, occupantsPendingByIv };
  const serverNowIso = new Date().toISOString();

  return (
    <InterventionsClient
      initialRows={rows}
      techs={techs}
      loadError={interventionsRes.error?.message ?? null}
      dashboard={dashboard}
      serverNowIso={serverNowIso}
      fullPage
      initialSelectedId={id}
    />
  );
}
