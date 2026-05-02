import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// GET /api/admin/interventions/[id]/historique
//
// Renvoie l'historique d'interventions associé au dossier courant :
// - par_appartement : groupé par occupant.appartement (interventions
//   précédentes sur les mêmes appartements)
// - par_acp : toutes les interventions sur la même ACP
// - recidives_detectees : count des interventions de même type_probleme
//   sur les 12 derniers mois pour les mêmes apparts
//
// Cache 5 min côté Vercel via Cache-Control. La détection de récidive
// n'est qu'un signal — l'admin valide.

interface HistEntry {
  id: string;
  ref: string | null;
  statut: string;
  type: string | null;
  date: string;
  description: string | null;
  appartements: string[];
  is_recidive: boolean;
}

interface ParAppartement {
  appartement: string;
  occupant: { nom: string | null; prenom: string | null; email: string | null } | null;
  interventions: HistEntry[];
}

const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { id } = await params;

  // Charge l'intervention courante : type, acp, occupants
  const { data: ivRow, error: ivErr } = await supabase
    .from('interventions')
    .select('id, type, acp_id, created_at')
    .eq('id', id)
    .maybeSingle();
  if (ivErr) return NextResponse.json({ ok: false, error: ivErr.message }, { status: 500 });
  if (!ivRow) return NextResponse.json({ ok: false, error: 'Intervention introuvable.' }, { status: 404 });
  const currentType = (ivRow.type as string | null) ?? null;
  const currentAcpId = (ivRow.acp_id as string | null) ?? null;

  // Occupants de l'intervention courante (pour avoir leurs apparts)
  const { data: currentOccsData } = await supabase
    .from('occupants')
    .select('id, intervention_id, appartement, nom, prenom, email')
    .eq('intervention_id', id);
  type Occ = { id: string; intervention_id: string; appartement: string | null; nom: string | null; prenom: string | null; email: string | null };
  const currentOccs = (currentOccsData ?? []) as Occ[];
  const currentApts = Array.from(new Set(
    currentOccs.map((o) => (o.appartement ?? '').toLowerCase().trim()).filter(Boolean),
  ));

  // Cherche les interventions candidates :
  //   - même ACP (si défini)
  //   - OU partageant un appartement avec les occupants courants
  // Limit 50 pour cap mémoire.
  let candidateIds: string[] = [];
  if (currentAcpId) {
    const { data: byAcp } = await supabase
      .from('interventions')
      .select('id')
      .eq('acp_id', currentAcpId)
      .neq('id', id)
      .order('created_at', { ascending: false })
      .limit(100);
    candidateIds = ((byAcp ?? []) as { id: string }[]).map((r) => r.id);
  }
  if (currentApts.length > 0) {
    const { data: occMatch } = await supabase
      .from('occupants')
      .select('intervention_id, appartement')
      .neq('intervention_id', id);
    for (const r of (occMatch ?? []) as { intervention_id: string; appartement: string | null }[]) {
      const lc = (r.appartement ?? '').toLowerCase().trim();
      if (lc && currentApts.includes(lc) && !candidateIds.includes(r.intervention_id)) {
        candidateIds.push(r.intervention_id);
      }
    }
  }
  if (candidateIds.length === 0) {
    return NextResponse.json({
      ok: true,
      par_appartement: [],
      par_acp: [],
      recidives_detectees: 0,
    }, { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=60' } });
  }

  // Charge les interventions candidates + leurs occupants pour grouper
  const { data: ivData } = await supabase
    .from('interventions')
    .select('id, ref, statut, type, created_at, description, acp_id')
    .in('id', candidateIds)
    .order('created_at', { ascending: false })
    .limit(50);
  type IvLite = { id: string; ref: string | null; statut: string; type: string | null; created_at: string; description: string | null; acp_id: string | null };
  const interventions = (ivData ?? []) as IvLite[];

  const { data: occData } = await supabase
    .from('occupants')
    .select('intervention_id, appartement, nom, prenom, email')
    .in('intervention_id', interventions.map((iv) => iv.id));
  type OccLite = { intervention_id: string; appartement: string | null; nom: string | null; prenom: string | null; email: string | null };
  const allOccs = (occData ?? []) as OccLite[];
  const occsByIv = new Map<string, OccLite[]>();
  for (const o of allOccs) {
    if (!occsByIv.has(o.intervention_id)) occsByIv.set(o.intervention_id, []);
    occsByIv.get(o.intervention_id)!.push(o);
  }

  const nowMs = Date.now();
  function isRecidive(iv: IvLite): boolean {
    if (!currentType || !iv.type) return false;
    if (iv.type !== currentType) return false;
    const ageMs = nowMs - new Date(iv.created_at).getTime();
    return ageMs > 0 && ageMs < TWELVE_MONTHS_MS;
  }

  // Build par_acp (toutes les interventions sur la même ACP, toutes types)
  const par_acp: HistEntry[] = currentAcpId
    ? interventions
        .filter((iv) => iv.acp_id === currentAcpId)
        .map((iv) => {
          const apts = (occsByIv.get(iv.id) ?? [])
            .map((o) => o.appartement ?? '')
            .filter(Boolean);
          return {
            id: iv.id,
            ref: iv.ref,
            statut: iv.statut,
            type: iv.type,
            date: iv.created_at,
            description: iv.description,
            appartements: Array.from(new Set(apts)),
            is_recidive: isRecidive(iv),
          };
        })
    : [];

  // Build par_appartement : pour chaque appartement courant, liste les
  // interventions qui ont un occupant sur ce même apt
  const par_appartement: ParAppartement[] = [];
  for (const aptLc of currentApts) {
    // Récupère le tuple "courant" pour cet apt (premier match)
    const currentForApt = currentOccs.find(
      (o) => (o.appartement ?? '').toLowerCase().trim() === aptLc,
    );
    if (!currentForApt) continue;
    const aptDisplay = currentForApt.appartement ?? aptLc;
    const matched = interventions.filter((iv) => {
      const occs = occsByIv.get(iv.id) ?? [];
      return occs.some((o) => (o.appartement ?? '').toLowerCase().trim() === aptLc);
    });
    if (matched.length === 0) continue;
    par_appartement.push({
      appartement: aptDisplay,
      occupant: {
        nom: currentForApt.nom,
        prenom: currentForApt.prenom,
        email: currentForApt.email,
      },
      interventions: matched.map((iv) => {
        const apts = (occsByIv.get(iv.id) ?? []).map((o) => o.appartement ?? '').filter(Boolean);
        return {
          id: iv.id,
          ref: iv.ref,
          statut: iv.statut,
          type: iv.type,
          date: iv.created_at,
          description: iv.description,
          appartements: Array.from(new Set(apts)),
          is_recidive: isRecidive(iv),
        };
      }),
    });
  }

  const recidives_detectees = par_appartement.reduce(
    (acc, group) => acc + group.interventions.filter((iv) => iv.is_recidive).length,
    0,
  );

  return NextResponse.json({
    ok: true,
    par_appartement,
    par_acp,
    recidives_detectees,
  }, { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=60' } });
}
