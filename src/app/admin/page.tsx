import { createClient } from '@/lib/supabase/server';
import { TECH_EMAILS } from '@/lib/auth/roles';
import type { Acp, Intervention, Occupant, Organisation, Utilisateur, InterventionRow, CreneauDisponible } from '@/lib/types/database';
import { InterventionsClient } from './InterventionsClient';

export const dynamic = 'force-dynamic';

type AcpLite = Pick<Acp, 'id' | 'nom' | 'adresse' | 'ville'>;

export type FreeSlot = Pick<CreneauDisponible, 'id' | 'technicien_id' | 'date' | 'heure_debut' | 'heure_fin'>;

export interface DashboardData {
  freeSlotsByTech: Record<string, FreeSlot[]>;
  occupantsPendingByIv: Record<string, Pick<Occupant, 'id' | 'appartement' | 'nom' | 'conf'>[]>;
}

export default async function AdminPipelinePage() {
  const supabase = await createClient();

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayISO = `${todayStart.getFullYear()}-${String(todayStart.getMonth() + 1).padStart(2, '0')}-${String(todayStart.getDate()).padStart(2, '0')}`;

  const [interventionsRes, acpsRes, orgsRes, usersRes, slotsRes] = await Promise.all([
    supabase
      .from('interventions')
      .select('*')
      .order('created_at', { ascending: false }),
    supabase.from('acps').select('id,nom,adresse,ville'),
    supabase.from('organisations').select('id,nom,type,email'),
    supabase
      .from('utilisateurs')
      .select('id,prenom,nom,email')
      .in('email', TECH_EMAILS as unknown as string[])
      .order('prenom', { ascending: true }),
    supabase
      .from('creneaux_disponibles')
      .select('id, technicien_id, date, heure_debut, heure_fin')
      .eq('statut', 'libre')
      .gte('date', todayISO)
      .order('date', { ascending: true })
      .order('heure_debut', { ascending: true }),
  ]);

  if (interventionsRes.error) {
    console.warn('[admin] interventions query error:', interventionsRes.error.message);
  }

  const interventions: Intervention[] = interventionsRes.data ?? [];
  const acps: AcpLite[] = (acpsRes.data as AcpLite[] | null) ?? [];
  const orgs: Pick<Organisation, 'id' | 'nom' | 'type' | 'email'>[] = orgsRes.data ?? [];
  const techs: Utilisateur[] = usersRes.data ?? [];
  const freeSlots: FreeSlot[] = (slotsRes.data ?? []) as FreeSlot[];

  const acpMap = new Map(acps.map((a) => [a.id, a]));
  const orgMap = new Map(orgs.map((o) => [o.id, o]));
  const techMap = new Map(techs.map((t) => [t.id, t]));

  const rows: InterventionRow[] = interventions.map((iv) => ({
    ...iv,
    acp: iv.acp_id ? (acpMap.get(iv.acp_id) ?? null) : null,
    syndic: iv.syndic_id ? (orgMap.get(iv.syndic_id) ?? null) : null,
    technicien: iv.technicien_id ? (techMap.get(iv.technicien_id) ?? null) : null,
  }));

  // Group free slots by technicien
  const freeSlotsByTech: Record<string, FreeSlot[]> = {};
  for (const s of freeSlots) {
    if (!s.technicien_id) continue;
    if (!freeSlotsByTech[s.technicien_id]) freeSlotsByTech[s.technicien_id] = [];
    freeSlotsByTech[s.technicien_id].push(s);
  }

  // Occupants en attente pour les interventions actives (non-clôturées)
  const activeIvIds = rows.filter((r) => r.statut !== 'cloturee').map((r) => r.id);
  let occupantsPendingByIv: Record<string, Pick<Occupant, 'id' | 'appartement' | 'nom' | 'conf'>[]> = {};
  if (activeIvIds.length > 0) {
    const occRes = await supabase
      .from('occupants')
      .select('id, intervention_id, appartement, nom, conf')
      .in('intervention_id', activeIvIds);
    const all = (occRes.data ?? []) as (Pick<Occupant, 'id' | 'appartement' | 'nom' | 'conf'> & { intervention_id: string })[];
    for (const o of all) {
      if (o.conf === 'confirme' || o.conf === 'decline') continue;
      if (!occupantsPendingByIv[o.intervention_id]) occupantsPendingByIv[o.intervention_id] = [];
      occupantsPendingByIv[o.intervention_id].push({ id: o.id, appartement: o.appartement, nom: o.nom, conf: o.conf });
    }
  }

  const dashboard: DashboardData = { freeSlotsByTech, occupantsPendingByIv };

  // Référence temporelle figée côté serveur — sert d'état initial
  // partagé pour le rendu SSR + 1ʳᵉ hydratation client (évite React #418).
  const serverNowIso = new Date().toISOString();

  return (
    <InterventionsClient
      initialRows={rows}
      techs={techs}
      loadError={interventionsRes.error?.message ?? null}
      dashboard={dashboard}
      serverNowIso={serverNowIso}
    />
  );
}
