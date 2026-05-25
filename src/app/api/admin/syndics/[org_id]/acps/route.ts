import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from "@/lib/auth/server";

export const dynamic = 'force-dynamic';

// GET /api/admin/syndics/[org_id]/acps
// Liste les ACPs liées au syndic (cascade `acps.syndic_id` ou
// `acps.syndic_id_ref` — les 2 colonnes coexistent depuis la migration
// 2026-05-14_emails_syndic.sql) avec le nombre d'interventions par ACP.
//
// Sortie : { ok: true, acps: [{ id, nom, adresse, ville, code_postal, intervention_count }] }
//
// Tri par nom (asc, fr-BE).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ org_id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { org_id } = await params;

  const { data: acpsRaw, error } = await supabase
    .from('acps')
    .select('id, nom, adresse, ville, code_postal')
    .or(`syndic_id.eq.${org_id},syndic_id_ref.eq.${org_id}`);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const acps = (acpsRaw ?? []) as Array<{
    id: string;
    nom: string | null;
    adresse: string | null;
    ville: string | null;
    code_postal: string | null;
  }>;

  // Compte les interventions par acp_id en une seule requête (filtre les
  // soft-deleted). Si la liste d'ids est vide on évite l'aller-retour.
  const counts = new Map<string, number>();
  if (acps.length > 0) {
    const ids = acps.map((a) => a.id);
    const { data: ivRows, error: ivErr } = await supabase
      .from('interventions')
      .select('acp_id')
      .in('acp_id', ids)
      .is('deleted_at', null);
    if (ivErr) return NextResponse.json({ ok: false, error: ivErr.message }, { status: 500 });
    for (const r of (ivRows ?? []) as { acp_id: string | null }[]) {
      if (!r.acp_id) continue;
      counts.set(r.acp_id, (counts.get(r.acp_id) ?? 0) + 1);
    }
  }

  const enriched = acps
    .map((a) => ({
      id: a.id,
      nom: a.nom,
      adresse: a.adresse,
      ville: a.ville,
      code_postal: a.code_postal,
      intervention_count: counts.get(a.id) ?? 0,
    }))
    .sort((a, b) => (a.nom ?? '').localeCompare(b.nom ?? '', 'fr-BE'));

  return NextResponse.json({ ok: true, acps: enriched });
}
