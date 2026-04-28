import { NextResponse } from 'next/server';
import { checkRapportAccess } from '@/lib/rapport/access';
import { buildRapportPdf } from '@/lib/rapport/dispatch';
import { createAdminClient } from '@/lib/supabase/admin';

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

  // 1. Vérifie un upload manuel dans le bucket documents
  try {
    const admin = createAdminClient();
    const { data: blob } = await admin.storage
      .from('documents')
      .download(`${id}/rapport.pdf`);
    if (blob) {
      const arrayBuffer = await blob.arrayBuffer();
      const body = new Uint8Array(arrayBuffer);
      return new Response(body, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="rapport-${id}.pdf"`,
          'Content-Length': String(body.byteLength),
          'Cache-Control': 'private, no-store, must-revalidate',
        },
      });
    }
  } catch {
    // Pas de service-role configuré ou bucket absent — fallback génération.
  }

  // 2. Sinon, génération à la volée via @react-pdf
  const built = await buildRapportPdf(id);
  if (!built.ok) {
    return NextResponse.json({ error: built.error }, { status: 500 });
  }

  const body = new Uint8Array(built.pdfBuffer);
  return new Response(body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="rapport-${built.ref}.pdf"`,
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'private, no-store, must-revalidate',
    },
  });
}
