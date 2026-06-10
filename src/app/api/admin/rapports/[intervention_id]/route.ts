import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from "@/lib/auth/server";

export const dynamic = 'force-dynamic';

// GET — état + CONTENU du rapport (statut, traçabilité, 4 sections texte) et
// les photos de l'intervention, pour le panneau de validation admin
// (consultation + correction). Sert au drawer admin à afficher le bon badge,
// le bon bouton (Valider / Envoyer / Renvoyer), les sections éditables et la
// galerie photos.
//
// Colonnes réelles (cf. db/migrations) :
//   rapports             : degats, inspection, conclusion, recommandations, statut, valide_*, transmis_*
//   photos_interventions : drive_url (affichable direct), filename, section, ordre, label, uploaded_at
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
    .select('statut, valide_par, valide_at, transmis_at, transmis_a, degats, inspection, conclusion, recommandations')
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

  // Photos de l'intervention — triées par ordre (manuel) puis date de prise
  // (uploaded_at). drive_url est directement affichable (webViewLink Drive).
  const { data: photosData } = await supabase
    .from('photos_interventions')
    .select('id, drive_url, filename, label, section, ordre, uploaded_at')
    .eq('intervention_id', intervention_id)
    .order('ordre', { ascending: true })
    .order('uploaded_at', { ascending: true });

  const photos = (photosData ?? []).map((p) => ({
    id: p.id as string,
    url: p.drive_url as string,
    caption: (p.label as string | null) ?? null,
    piece: (p.section as string | null) ?? null,
    ordre_rapport: (p.ordre as number | null) ?? 0,
    pris_at: (p.uploaded_at as string | null) ?? null,
    filename: (p.filename as string | null) ?? null,
  }));

  return NextResponse.json({ ok: true, rapport: data ?? null, photos });
}
