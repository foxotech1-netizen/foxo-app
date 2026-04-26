import { NextResponse } from 'next/server';
import { checkRapportAccess } from '@/lib/rapport/access';
import { createClient } from '@/lib/supabase/server';

// Stream du PDF facture stocké dans le bucket Storage 'invoices'.
// Contrôle d'accès identique au rapport (admin / tech / partner / occupant).
// La facture n'existe que si l'admin l'a émise via /admin (FactureBlock).

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(request.url);
  const occupantId = url.searchParams.get('occupant');

  const access = await checkRapportAccess(id, { occupantId });
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const supabase = await createClient();
  const { data: blob, error } = await supabase.storage
    .from('invoices')
    .download(`${id}.pdf`);

  if (error || !blob) {
    return NextResponse.json(
      {
        error: 'Facture pas encore disponible.',
        detail: error?.message,
      },
      { status: 404 },
    );
  }

  const arrayBuffer = await blob.arrayBuffer();
  const body = new Uint8Array(arrayBuffer);

  return new Response(body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="facture-${id}.pdf"`,
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'private, no-store, must-revalidate',
    },
  });
}
