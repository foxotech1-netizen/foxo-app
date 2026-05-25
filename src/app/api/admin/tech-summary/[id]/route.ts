import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from "@/lib/auth/server";

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
  if (!id) return NextResponse.json({ ok: false, error: 'ID manquant.' }, { status: 400 });

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const todayISO = `${todayStart.getFullYear()}-${String(todayStart.getMonth() + 1).padStart(2, '0')}-${String(todayStart.getDate()).padStart(2, '0')}`;

  const [todayIvs, monthRealisees, monthRapports, nextSlots, tech] = await Promise.all([
    supabase
      .from('interventions')
      .select('id, ref, type, creneau_debut, acp_id, statut')
      .eq('technicien_id', id)
      .gte('creneau_debut', todayStart.toISOString())
      .lt('creneau_debut', tomorrowStart.toISOString())
      .order('creneau_debut', { ascending: true }),
    supabase
      .from('interventions')
      .select('id', { count: 'exact', head: true })
      .eq('technicien_id', id)
      .in('statut', ['realisee', 'rapport', 'cloturee'])
      .gte('updated_at', monthStart.toISOString())
      .lt('updated_at', monthEnd.toISOString()),
    supabase
      .from('interventions')
      .select('id', { count: 'exact', head: true })
      .eq('technicien_id', id)
      .in('statut', ['rapport', 'cloturee'])
      .gte('updated_at', monthStart.toISOString())
      .lt('updated_at', monthEnd.toISOString()),
    supabase
      .from('creneaux_disponibles')
      .select('id, date, heure_debut, heure_fin')
      .eq('technicien_id', id)
      .eq('statut', 'libre')
      .gte('date', todayISO)
      .order('date', { ascending: true })
      .order('heure_debut', { ascending: true })
      .limit(3),
    supabase
      .from('utilisateurs')
      .select('prenom, nom, email')
      .eq('id', id)
      .maybeSingle(),
  ]);

  // Charge les noms ACP pour les interventions du jour
  const acpIds = Array.from(new Set((todayIvs.data ?? []).map((iv) => iv.acp_id).filter(Boolean) as string[]));
  const acpRes = acpIds.length
    ? await supabase.from('acps').select('id, nom').in('id', acpIds)
    : { data: [] };
  const acpMap = new Map(((acpRes.data ?? []) as { id: string; nom: string }[]).map((a) => [a.id, a.nom]));

  return NextResponse.json({
    ok: true,
    tech: tech.data ?? null,
    today: (todayIvs.data ?? []).map((iv) => ({
      id: iv.id,
      ref: iv.ref,
      type: iv.type,
      creneau_debut: iv.creneau_debut,
      statut: iv.statut,
      acp_nom: iv.acp_id ? acpMap.get(iv.acp_id) ?? null : null,
    })),
    month_realisees: monthRealisees.count ?? 0,
    month_rapports: monthRapports.count ?? 0,
    next_slots: nextSlots.data ?? [],
  });
}
