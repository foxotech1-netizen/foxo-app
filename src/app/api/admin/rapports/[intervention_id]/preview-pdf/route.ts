import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from "@/lib/auth/server";
import { buildRapportPdf } from '@/lib/rapport/dispatch';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET — Aperçu PDF du rapport pour l'admin, AVANT transmission.
//
// Génère le PDF avec EXACTEMENT le même billet de construction que l'envoi réel
// au syndic : réutilise buildRapportPdf (le helper partagé que
// dispatchRapportToSyndic appelle aussi). Ce que l'admin voit ici est donc
// identique au PDF qui partira. Renvoyé inline pour ouverture dans un onglet.
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

  const built = await buildRapportPdf(intervention_id);
  if (!built.ok) {
    return NextResponse.json({ ok: false, error: built.error }, { status: 400 });
  }

  const body = new Uint8Array(built.pdfBuffer);
  return new Response(body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="rapport-${built.ref}-apercu.pdf"`,
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'private, no-store, must-revalidate',
    },
  });
}
