import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from "@/lib/auth/server";

export const dynamic = 'force-dynamic';

// GET — état du rapport (statut + traçabilité validation/transmission) pour
// une intervention. Sert au drawer admin (C2b) à afficher le bon badge et le
// bon bouton (Valider / Envoyer / Renvoyer).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ intervention_id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { intervention_id } = await params;

  const { data, error } = await supabase
    .from('rapports')
    .select('statut, valide_par, valide_at, transmis_at, transmis_a')
    .eq('intervention_id', intervention_id)
    .maybeSingle();

  if (error) {
    console.error('[rapports GET] supabase error', {
      intervention_id,
      code: (error as { code?: string }).code ?? null,
      message: error.message,
      details: (error as { details?: string }).details ?? null,
      hint: (error as { hint?: string }).hint ?? null,
    });
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, rapport: data ?? null });
}
