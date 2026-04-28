import { NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import path from 'node:path';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';
import { FactureFoxoPdf } from '@/lib/facturation/FactureFoxoPdf';
import { generateEpcQrDataUrl } from '@/lib/facturation/epc-qr';
import { VENDOR } from '@/lib/constants/vendor';
import type { Facture } from '@/lib/types/database';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 });
  }

  const { id } = await params;
  const { data, error } = await supabase
    .from('factures')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) {
    return NextResponse.json({ error: 'Facture introuvable.' }, { status: 404 });
  }
  const facture = data as Facture;

  const ttc = facture.montant_ttc ?? 0;
  let qrDataUrl: string | undefined;
  try {
    qrDataUrl = await generateEpcQrDataUrl({
      beneficiaryName: VENDOR.name,
      iban: VENDOR.iban,
      amountEur: ttc > 0 ? ttc : 0.01,
      bba: facture.reference_structuree ?? undefined,
    });
  } catch (e) {
    console.warn('[api/admin/facture] EPC QR error:', e);
  }

  const logoSrc = path.join(process.cwd(), 'public', 'foxo-logo-transparent.png');

  let pdf: Buffer;
  try {
    pdf = await renderToBuffer(
      FactureFoxoPdf({ facture, qrDataUrl, logoSrc }),
    );
  } catch (e) {
    console.warn('[api/admin/facture] PDF render error:', e);
    return NextResponse.json({ error: 'Erreur génération PDF.' }, { status: 500 });
  }

  const body = new Uint8Array(pdf);
  return new Response(body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="facture-${facture.numero}.pdf"`,
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'private, no-store, must-revalidate',
    },
  });
}
