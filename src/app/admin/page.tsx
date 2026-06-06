import { createClient } from '@/lib/supabase/server';
import { TECH_EMAILS } from '@/lib/auth/roles';
import type { Acp, Delegue, Intervention, Occupant, Organisation, Utilisateur, InterventionRow, CreneauDisponible } from '@/lib/types/database';
import { InterventionsClient } from './InterventionsClient';
import { SyndicMapWrapper } from '@/components/portal/SyndicMapWrapper';

export const dynamic = 'force-dynamic';

type AcpLite = Pick<Acp, 'id' | 'nom' | 'adresse' | 'ville' | 'lat' | 'lng'>;

export type FreeSlot = Pick<CreneauDisponible, 'id' | 'technicien_id' | 'date' | 'heure_debut' | 'heure_fin'>;

export interface RecentOccupantResponse {
  occupant_id: string;
  intervention_id: string;
  prenom: string | null;
  nom: string | null;
  appartement: string | null;
  conf: 'confirme' | 'en_attente' | 'decline' | null;
  confirmed_at: string;
  proposed_creneau_debut: string | null;
  iv_ref: string | null;
  iv_acp_nom: string | null;
}

export interface DashboardData {
  freeSlotsByTech: Record<string, FreeSlot[]>;
  occupantsPendingByIv: Record<string, Pick<Occupant, 'id' | 'appartement' | 'nom' | 'conf'>[]>;
  recentResponses: RecentOccupantResponse[];
  // Déprécié : le briefing IA a été retiré du Dashboard (refonte tunnel).
  // Champ optionnel conservé pour rétro-compat des appelants qui le posent
  // encore (ex. interventions/[id]/page.tsx) — plus aucun rendu.
  briefingText?: string | null;
}

export default async function AdminPipelinePage() {
  const supabase = await createClient();

  // Email de l'admin connecté — passé à InterventionsClient pour
  // alimenter MessagesPanel (auteur_email côté écriture).
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
      .in('email', TECH_EMAILS as unknown as string[])
      .order('prenom', { ascending: true }),
    supabase
      .from('creneaux_disponibles')
      .select('id, technicien_id, date, heure_debut, heure_fin')
      .eq('statut', 'libre')
      .gte('date', todayISO)
      .order('date', { ascending: true })
      .order('heure_debut', { ascending: true }),
    // Délégués : pour le drawer "Demandeur" — on charge tous les
    // délégués actifs et on map par ID. Si la table n'existe pas
    // encore (migration absente), on tolère l'erreur silencieusement.
    supabase.from('delegues').select('id, prenom, nom, email, telephone'),
  ]);

  if (interventionsRes.error) {
    console.warn('[admin] interventions query error:', interventionsRes.error.message);
  }

  const interventions: Intervention[] = interventionsRes.data ?? [];
  const acps: AcpLite[] = (acpsRes.data as AcpLite[] | null) ?? [];
  const orgs: Pick<Organisation, 'id' | 'nom' | 'type' | 'email'>[] = orgsRes.data ?? [];
  const techs: Utilisateur[] = usersRes.data ?? [];
  const freeSlots: FreeSlot[] = (slotsRes.data ?? []) as FreeSlot[];
  type DelegueLite = Pick<Delegue, 'id' | 'prenom' | 'nom' | 'email' | 'telephone'>;
  const delegues: DelegueLite[] = (deleguesRes.data as DelegueLite[] | null) ?? [];

  // Si on intervention pointe vers un syndic via syndic_id ou
  // organisation_id, on prend l'organisation matchée. Idem pour le
  // délégué : iv.delegue_id → table delegues.
  const acpMap = new Map(acps.map((a) => [a.id, a]));
  const orgMap = new Map(orgs.map((o) => [o.id, o]));
  const techMap = new Map(techs.map((t) => [t.id, t]));
  const delegueMap = new Map(delegues.map((d) => [d.id, d]));

  // Détection de récidive en mémoire — toutes les interventions sont déjà
  // chargées, on évite un round-trip par ligne. O(n) avec un index par
  // (acp_id, type normalisé) sur la fenêtre 12 mois. Aligné sur la
  // fenêtre TWELVE_MONTHS_MS du drawer Historique.
  const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;
  const recidiveCutoffMs = Date.now() - TWELVE_MONTHS_MS;
  const recidiveIndex = new Map<string, string[]>(); // key = acp_id|type → [iv.id...]
  for (const iv of interventions) {
    if (!iv.acp_id || !iv.type) continue;
    const created = iv.created_at ? new Date(iv.created_at).getTime() : 0;
    if (created < recidiveCutoffMs) continue;
    const key = `${iv.acp_id}|${iv.type.trim().toLowerCase()}`;
    if (!recidiveIndex.has(key)) recidiveIndex.set(key, []);
    recidiveIndex.get(key)!.push(iv.id);
  }

  // Compte des messages non lus côté admin par intervention. Best-effort :
  // si la table messages n'existe pas (migration 2026-05-27 pas appliquée),
  // on tolère silencieusement. Group côté code : Postgrest n'expose pas
  // GROUP BY directement, et le volume reste raisonnable (un seul fetch).
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
    /* table messages absente — noop, badge 💬 ne s'affichera pas */
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

  // Pins carte admin : toutes les interventions actives (non-clôturées)
  // dont l'ACP a des coords Nominatim (cf. migration 2026-05-18 + fix
  // création ACP commit 4452942). Volume potentiellement élevé sur
  // l'historique global ; filter clôturées exclues côté serveur pour
  // limiter le payload client.
  const adminPins = interventions
    .filter((iv) => iv.statut !== 'cloturee')
    .map((iv) => {
      const acp = acps.find((a) => a.id === iv.acp_id);
      if (!acp?.lat || !acp?.lng) return null;
      return {
        id: iv.id,
        lat: Number(acp.lat),
        lng: Number(acp.lng),
        ref: iv.ref ?? null,
        acp_nom: acp.nom ?? '—',
        statut: iv.statut,
        priorite: iv.priorite ?? undefined,
        type: iv.type ?? null,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

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

  // Réponses occupants récentes (< 48h) sur des interventions encore actives
  // (pas cloturee ni realisee) — pour le badge "📬 nouvelle réponse" et la
  // carte dédiée du dashboard.
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

  // Référence temporelle figée côté serveur — sert d'état initial
  // partagé pour le rendu SSR + 1ʳᵉ hydratation client (évite React #418).
  const serverNowIso = new Date().toISOString();

  return (
    <>
      {adminPins.length > 0 && (
        // Carte des interventions : visible uniquement à partir du breakpoint
        // tablette (md ≥ 768px). Sur mobile, le composant Dashboard la
        // re-rend dans son accordéon "Tableau de bord détaillé" via la prop
        // adminPins propagée — évite de pousser la carte tout en haut sur
        // mobile au détriment du briefing IA.
        <section className="px-4 pb-4 hidden md:block">
          <h2 className="section-label mb-3">Carte des interventions</h2>
          <SyndicMapWrapper pins={adminPins} basePath="/admin/interventions" />
        </section>
      )}
      <InterventionsClient
        initialRows={rows}
        techs={techs}
        loadError={interventionsRes.error?.message ?? null}
        dashboard={dashboard}
        serverNowIso={serverNowIso}
        adminEmail={adminEmail}
        adminPins={adminPins}
      />
    </>
  );
}
