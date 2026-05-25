import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from "@/lib/auth/server";
import type { StatutIntervention } from '@/lib/types/database';

export const dynamic = 'force-dynamic';

interface InterventionRow {
  id: string;
  ref: string | null;
  statut: StatutIntervention;
  creneau_debut: string | null;
  adresse: string | null;
  acp_nom: string | null;
  syndic_nom: string | null;
}

export interface TechInterventionsResponse {
  ok: true;
  interventions: InterventionRow[];
  stats: { total: number; ce_mois: number; cette_annee: number };
}

const LIMIT = 200;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ ok: false, error: 'ID manquant.' }, { status: 400 });
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  const yearStart = new Date(now.getFullYear(), 0, 1).toISOString();
  const yearEnd = new Date(now.getFullYear() + 1, 0, 1).toISOString();

  const [ivsRes, totalRes, moisRes, anneeRes] = await Promise.all([
    supabase
      .from('interventions')
      .select('id, ref, statut, creneau_debut, adresse, acp_id, syndic_id')
      .eq('technicien_id', id)
      .is('deleted_at', null)
      .order('creneau_debut', { ascending: false, nullsFirst: false })
      .limit(LIMIT),
    supabase
      .from('interventions')
      .select('id', { count: 'exact', head: true })
      .eq('technicien_id', id)
      .is('deleted_at', null),
    supabase
      .from('interventions')
      .select('id', { count: 'exact', head: true })
      .eq('technicien_id', id)
      .is('deleted_at', null)
      .gte('creneau_debut', monthStart)
      .lt('creneau_debut', monthEnd),
    supabase
      .from('interventions')
      .select('id', { count: 'exact', head: true })
      .eq('technicien_id', id)
      .is('deleted_at', null)
      .gte('creneau_debut', yearStart)
      .lt('creneau_debut', yearEnd),
  ]);

  if (ivsRes.error) {
    return NextResponse.json({ ok: false, error: ivsRes.error.message }, { status: 500 });
  }

  type IvRaw = {
    id: string;
    ref: string | null;
    statut: StatutIntervention;
    creneau_debut: string | null;
    adresse: string | null;
    acp_id: string | null;
    syndic_id: string | null;
  };
  const ivs = (ivsRes.data ?? []) as IvRaw[];

  const acpIds = Array.from(new Set(ivs.map((i) => i.acp_id).filter((x): x is string => Boolean(x))));
  const syndicIds = Array.from(new Set(ivs.map((i) => i.syndic_id).filter((x): x is string => Boolean(x))));

  const [acpsRes, orgsRes] = await Promise.all([
    acpIds.length
      ? supabase.from('acps').select('id, nom').in('id', acpIds)
      : Promise.resolve({ data: [] as { id: string; nom: string }[] }),
    syndicIds.length
      ? supabase.from('organisations').select('id, nom').in('id', syndicIds)
      : Promise.resolve({ data: [] as { id: string; nom: string }[] }),
  ]);

  const acpMap = new Map((acpsRes.data ?? []).map((a) => [a.id, a.nom]));
  const orgMap = new Map((orgsRes.data ?? []).map((o) => [o.id, o.nom]));

  const interventions: InterventionRow[] = ivs.map((iv) => ({
    id: iv.id,
    ref: iv.ref,
    statut: iv.statut,
    creneau_debut: iv.creneau_debut,
    adresse: iv.adresse,
    acp_nom: iv.acp_id ? (acpMap.get(iv.acp_id) ?? null) : null,
    syndic_nom: iv.syndic_id ? (orgMap.get(iv.syndic_id) ?? null) : null,
  }));

  const payload: TechInterventionsResponse = {
    ok: true,
    interventions,
    stats: {
      total: totalRes.count ?? 0,
      ce_mois: moisRes.count ?? 0,
      cette_annee: anneeRes.count ?? 0,
    },
  };
  return NextResponse.json(payload);
}
