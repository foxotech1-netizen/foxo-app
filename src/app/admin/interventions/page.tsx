import { createClient } from '@/lib/supabase/server';
import type { Acp, Delegue, Intervention, Occupant, Organisation, Utilisateur, InterventionRow } from '@/lib/types/database';
import { InterventionsClient } from '../InterventionsClient';
import { CreateInterventionButton } from './CreateInterventionButton';
import type { DashboardData, FreeSlot, RecentOccupantResponse } from '../page';

export const dynamic = 'force-dynamic';

type AcpLite = Pick<Acp, 'id' | 'nom' | 'adresse' | 'ville' | 'lat' | 'lng'>;

// Page liste dédiée « Interventions » (accessible depuis le sidebar). Réutilise
// <InterventionsClient> en mode `listOnly` : même liste + barre de filtres que
// le dashboard, MAIS sans le titre « Tableau de bord » ni les widgets dashboard
// (Briefing IA, Missions, KPIs, chat). Données chargées à l'identique de
// /admin (src/app/admin/page.tsx), sans la carte/pins (widget masqué ici).
export default async function AdminInterventionsListPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  const adminEmail = user?.email ?? '';

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayISO = `${todayStart.getFullYear()}-${String(todayStart.getMonth() + 1).padStart(2, '0')}-${String(todayStart.getDate()).padStart(2, '0')}`;

  const [interventionsRes, acpsRes, orgsRes, usersRes, slotsRes, deleguesRes] = await Promise.all([
    supabase
      .from('interventions')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    supabase.from('acps').select('id, nom, adresse, ville, lat, lng'),
    supabase.from('organisations').select('id,nom,type,email'),
    supabase
      .from('utilisateurs')
      .select('id,prenom,nom,email,couleur,role,actif,organisation_id,telephone,last_seen_at,created_at')
      .eq('role', 'technicien')
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

  if (interventionsRes.error) {
    console.warn('[admin/interventions] interventions query error:', interventionsRes.error.message);
  }

  const interventions: Intervention[] = interventionsRes.data ?? [];
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

  // Détection de récidive en mémoire — index par (acp_id, type normalisé) sur
  // la fenêtre 12 mois (aligné sur /admin).
  const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;
  const recidiveCutoffMs = Date.now() - TWELVE_MONTHS_MS;
  const recidiveIndex = new Map<string, string[]>();
  for (const iv of interventions) {
    if (!iv.acp_id || !iv.type) continue;
    const created = iv.created_at ? new Date(iv.created_at).getTime() : 0;
    if (created < recidiveCutoffMs) continue;
    const key = `${iv.acp_id}|${iv.type.trim().toLowerCase()}`;
    if (!recidiveIndex.has(key)) recidiveIndex.set(key, []);
    recidiveIndex.get(key)!.push(iv.id);
  }

  // Messages non lus côté admin par intervention (best-effort, comme /admin).
  const unreadByIv = new Map<string, number>();
  try {
    const { data: unreadRows } = await supabase
      .from('messages')
      .select('intervention_id')
      .eq('lu_admin', false)
      .in('auteur_type', ['syndic', 'courtier', 'expert']);
    for (const r of (unreadRows ?? []) as { intervention_id: string }[]) {
      unreadByIv.set(r.intervention_id, (unreadByIv.get(r.intervention_id) ?? 0) + 1);
    }
  } catch {
    /* table messages absente — noop */
  }

  const rows: InterventionRow[] = interventions.map((iv) => {
    let recidive_count = 0;
    if (iv.acp_id && iv.type) {
      const key = `${iv.acp_id}|${iv.type.trim().toLowerCase()}`;
      const others = recidiveIndex.get(key);
      if (others) recidive_count = others.filter((x) => x !== iv.id).length;
    }
    return {
      ...iv,
      acp: iv.acp_id ? (acpMap.get(iv.acp_id) ?? null) : null,
      syndic: iv.syndic_id
        ? (orgMap.get(iv.syndic_id) ?? null)
        : iv.organisation_id ? (orgMap.get(iv.organisation_id) ?? null) : null,
      technicien: iv.technicien_id ? (techMap.get(iv.technicien_id) ?? null) : null,
      delegue: iv.delegue_id ? (delegueMap.get(iv.delegue_id) ?? null) : null,
      recidive_count,
      unread_messages_count: unreadByIv.get(iv.id) ?? 0,
    };
  });

  // Free slots groupés par technicien (alimente le drawer de planification).
  const freeSlotsByTech: Record<string, FreeSlot[]> = {};
  for (const s of freeSlots) {
    if (!s.technicien_id) continue;
    if (!freeSlotsByTech[s.technicien_id]) freeSlotsByTech[s.technicien_id] = [];
    freeSlotsByTech[s.technicien_id].push(s);
  }

  // Occupants en attente pour les interventions actives (badges de liste).
  const activeIvIds = rows.filter((r) => r.statut !== 'cloturee').map((r) => r.id);
  const occupantsPendingByIv: Record<string, Pick<Occupant, 'id' | 'appartement' | 'nom' | 'conf'>[]> = {};
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

  // Réponses occupants récentes (< 48h) sur interventions actives — badge
  // "📬 nouvelle réponse" dans la liste (même logique que /admin).
  const cutoff48h = new Date(Date.now() - 48 * 3600_000).toISOString();
  const ivById = new Map(rows.map((r) => [r.id, r]));
  const recentRes = await supabase
    .from('occupants')
    .select('id, intervention_id, prenom, nom, appartement, conf, confirmed_at, proposed_creneau_debut')
    .gte('confirmed_at', cutoff48h)
    .order('confirmed_at', { ascending: false })
    .limit(50);
  type RecentOccRow = {
    id: string;
    intervention_id: string;
    prenom: string | null;
    nom: string | null;
    appartement: string | null;
    conf: 'confirme' | 'en_attente' | 'decline' | null;
    confirmed_at: string;
    proposed_creneau_debut: string | null;
  };
  const recentResponses: RecentOccupantResponse[] = ((recentRes.data ?? []) as RecentOccRow[])
    .map((o) => {
      const iv = ivById.get(o.intervention_id);
      if (!iv || iv.statut === 'cloturee' || iv.statut === 'realisee') return null;
      return {
        occupant_id: o.id,
        intervention_id: o.intervention_id,
        prenom: o.prenom,
        nom: o.nom,
        appartement: o.appartement,
        conf: o.conf,
        confirmed_at: o.confirmed_at,
        proposed_creneau_debut: o.proposed_creneau_debut,
        iv_ref: iv.ref,
        iv_acp_nom: iv.acp?.nom ?? null,
      };
    })
    .filter((x): x is RecentOccupantResponse => x !== null);

  const dashboard: DashboardData = { freeSlotsByTech, occupantsPendingByIv, recentResponses };
  const serverNowIso = new Date().toISOString();

  return (
    <>
      <div className="px-6 pt-6 pb-1 flex items-center justify-between gap-3 flex-wrap flex-shrink-0">
        <h1 className="fxs-page-title">Interventions</h1>
        <CreateInterventionButton techs={techs} />
      </div>
      <InterventionsClient
        initialRows={rows}
        techs={techs}
        loadError={interventionsRes.error?.message ?? null}
        dashboard={dashboard}
        serverNowIso={serverNowIso}
        adminEmail={adminEmail}
        listOnly
      />
    </>
  );
}
