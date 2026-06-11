import { createClient } from '@/lib/supabase/server';
import { getCurrentSyndic } from '@/lib/portal/syndic';
import { buildOrgVisibilityFilter, getMandatedInterventionIds } from '@/lib/portal/org-visibility';
import { InterventionsPortalClient } from './InterventionsPortalClient';
import type { Acp, Intervention, PrioriteIntervention, StatutIntervention } from '@/lib/types/database';

export const dynamic = 'force-dynamic';

export type InterventionPortalItem = {
  id: string;
  ref: string | null;
  statut: StatutIntervention;
  priorite: PrioriteIntervention;
  type: string | null;
  description: string | null;
  creneau_debut: string | null;
  created_at: string;
  updated_at: string;
  // Localisation : nom + adresse + BCE de l'ACP. acp_nom porte aussi le nom
  // de l'assuré pour les courtiers ET experts (JSONB assureur.assure, avec
  // fallback dossiers_sinistres pour les rows courtier legacy).
  acp_id: string | null;
  acp_nom: string | null;
  acp_adresse: string | null;
  acp_bce: string | null;
  // Adresse de l'intervention (fallback si l'ACP n'a pas d'adresse).
  adresse: string | null;
  // Technicien assigné — null si pas encore attribué.
  technicien_id: string | null;
  technicien_nom: string | null;
  // Vrai si rapport disponible (statut rapport ou cloturee).
  has_rapport: boolean;
  // Champs courtier — vide pour syndic.
  ref_courtier: string | null;
  assureur_nom: string | null;
  // Référence syndic (colonne interventions.reference_externe, cf. migration
  // 2026-05-12 « référence dossier syndic/courtier »). Vide pour courtier.
  reference_externe: string | null;
  // Messages écrits par FoxO/l'admin (auteur_type='admin') et non encore lus
  // par le partenaire (lu_syndic=false). Miroir du badge admin.
  unread_messages_count: number;
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
  // Orgs "dossier sinistre" (courtier ET expert) : acp_nom porte le nom de
  // l'assuré plutôt que le nom de l'ACP (qu'ils n'ont pas).
  const isSinistre = org.type === 'courtier' || org.type === 'expert';
  const supabase = await createClient();

  // Visibilité : filtre canonique partagé (lien direct syndic_id/organisation_id
  // OU mandat dossier sinistre — cf. @/lib/portal/org-visibility).
  // Filtre soft delete (deleted_at IS NULL) pour rester aligné avec l'admin.
  const mandatedIds = await getMandatedInterventionIds(supabase, org.id);
  const { data, error } = await supabase
    .from('interventions')
    .select('id, ref, statut, priorite, type, description, creneau_debut, updated_at, created_at, acp_id, adresse, technicien_id, assureur, reference_externe')
    .or(buildOrgVisibilityFilter(org.id, mandatedIds))
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  const interventions: Intervention[] = (data as Intervention[] | null) ?? [];

  // ── Batch fetches en parallèle (ACPs, techniciens, dossiers courtier) ──
  const acpIds = Array.from(new Set(interventions.map((i) => i.acp_id).filter(Boolean) as string[]));
  const techIds = Array.from(new Set(interventions.map((i) => i.technicien_id).filter(Boolean) as string[]));
  const ivIds = interventions.map((i) => i.id);

  const [acpsRes, techRes, dossiersRes] = await Promise.all([
    acpIds.length > 0
      ? supabase.from('acps').select('id, nom, adresse, bce').in('id', acpIds)
      : Promise.resolve({ data: [] as Pick<Acp, 'id' | 'nom' | 'adresse' | 'bce'>[] }),
    techIds.length > 0
      ? supabase.from('utilisateurs').select('id, prenom, nom').in('id', techIds)
      : Promise.resolve({ data: [] as { id: string; prenom: string | null; nom: string | null }[] }),
    isCourtier && ivIds.length > 0
      ? supabase.from('dossiers_sinistres').select('intervention_id, assure, ref_courtier').in('intervention_id', ivIds)
      : Promise.resolve({ data: [] as DossierLite[] }),
  ]);

  const acpMap = new Map(
    ((acpsRes.data ?? []) as Pick<Acp, 'id' | 'nom' | 'adresse' | 'bce'>[]).map((a) => [a.id, a]),
  );
  const techMap = new Map(
    ((techRes.data ?? []) as { id: string; prenom: string | null; nom: string | null }[])
      .map((u) => [u.id, [u.prenom, u.nom].filter(Boolean).join(' ').trim() || null]),
  );
  const dossierMap = new Map(
    ((dossiersRes.data ?? []) as DossierLite[]).map((d) => [d.intervention_id, d]),
  );

  // ── Rapports réellement disponibles (transmis) ──
  // Le client RLS ne renvoie que les rapports visibles par le partenaire
  // (policy partner_select_published_rapports = statut 'transmis'). On
  // dérive has_rapport de la présence d'une ligne, alignant l'affichage sur
  // ce que le syndic peut effectivement télécharger (cf. RLS /api/rapport).
  const { data: rapportsDispo } = ivIds.length > 0
    ? await supabase.from('rapports').select('intervention_id').in('intervention_id', ivIds)
    : { data: [] as { intervention_id: string }[] };
  const rapportSet = new Set(
    ((rapportsDispo ?? []) as { intervention_id: string }[]).map((r) => r.intervention_id),
  );

  // ── Compte des messages non lus côté partenaire par intervention ──
  // Miroir du badge admin (cf. src/app/admin/page.tsx unreadByIv) : on compte
  // les messages écrits par FoxO (auteur_type='admin') et pas encore lus par
  // le partenaire (lu_syndic=false). Best-effort : si la table messages
  // n'existe pas, on tolère silencieusement et le badge ne s'affiche pas.
  const unreadByIv = new Map<string, number>();
  if (ivIds.length > 0) {
    try {
      const { data: unreadRows } = await supabase
        .from('messages')
        .select('intervention_id')
        .eq('lu_syndic', false)
        .eq('auteur_type', 'admin')
        .in('intervention_id', ivIds);
      for (const r of (unreadRows ?? []) as { intervention_id: string }[]) {
        unreadByIv.set(r.intervention_id, (unreadByIv.get(r.intervention_id) ?? 0) + 1);
      }
    } catch {
      /* table messages absente — noop, badge ne s'affichera pas */
    }
  }

  const items: InterventionPortalItem[] = interventions.map((iv) => {
    const acp = iv.acp_id ? acpMap.get(iv.acp_id) ?? null : null;
    const dossier = isCourtier ? dossierMap.get(iv.id) ?? null : null;
    // Préfère interventions.assureur.reference_sinistre (JSONB) sur
    // dossiers_sinistres.ref_courtier (legacy).
    const refSinistreNew = iv.assureur?.reference_sinistre ?? null;
    const refCourtier = (refSinistreNew && refSinistreNew.trim())
      || dossier?.ref_courtier
      || null;
    return {
      id: iv.id,
      ref: iv.ref,
      statut: iv.statut,
      priorite: iv.priorite,
      type: iv.type,
      description: iv.description,
      creneau_debut: iv.creneau_debut,
      created_at: iv.created_at,
      updated_at: iv.updated_at,
      acp_id: iv.acp_id,
      // Sinistre (courtier/expert) : nom de l'assuré, priorité au JSONB
      // assureur.assure (nouvelle écriture, couvre l'expert) puis fallback
      // dossiers_sinistres (rows courtier legacy). Sinon nom de l'ACP.
      acp_nom: isSinistre
        ? (iv.assureur?.assure || dossier?.assure || null)
        : (acp?.nom ?? null),
      acp_adresse: acp?.adresse ?? null,
      acp_bce: acp?.bce ?? null,
      adresse: iv.adresse,
      technicien_id: iv.technicien_id,
      technicien_nom: iv.technicien_id ? (techMap.get(iv.technicien_id) ?? null) : null,
      has_rapport: rapportSet.has(iv.id),
      ref_courtier: refCourtier,
      assureur_nom: iv.assureur?.nom ?? null,
      reference_externe: iv.reference_externe ?? null,
      unread_messages_count: unreadByIv.get(iv.id) ?? 0,
    };
  });

  return (
    <InterventionsPortalClient
      items={items}
      initialQuery={sp.q ?? ''}
      initialStatut={sp.statut ?? null}
      loadError={error?.message ?? null}
    />
  );
}
