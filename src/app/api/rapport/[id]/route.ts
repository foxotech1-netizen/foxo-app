import { NextResponse } from 'next/server';
import { checkRapportAccess } from '@/lib/rapport/access';
import { buildRapportPdf } from '@/lib/rapport/dispatch';

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

  const built = await buildRapportPdf(id);
  if (!built.ok) {
    return NextResponse.json({ error: built.error }, { status: 500 });
  }

  // Buffer Node → Uint8Array compatible Response
  const body = new Uint8Array(built.pdfBuffer);

  return new Response(body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="rapport-${built.ref}.pdf"`,
      'Content-Length': String(body.byteLength),
      // Pas de cache : auth-aware
      'Cache-Control': 'private, no-store, must-revalidate',
    },
  });
}
