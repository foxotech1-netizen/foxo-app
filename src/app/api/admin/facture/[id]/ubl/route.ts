// Téléchargement de l'UBL 2.1 / Peppol BIS 3.0 d'une facture ou d'un avoir.
// Même patron de garde admin que la route PDF voisine (../route.ts).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from '@/lib/auth/server';
import { buildUblXml, supplierParamsFromMap } from '@/lib/facturation/ubl';
import type { Facture, Parametre } from '@/lib/types/database';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 });
  }

  const { id } = await params;
  const { data, error } = await supabase
    .from('factures')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) {
    return NextResponse.json({ error: 'Document introuvable.' }, { status: 404 });
  }
  const facture = data as Facture;

  if (facture.type === 'devis') {
    return NextResponse.json(
      { error: 'UBL non supporté pour les devis.' },
      { status: 400 },
    );
  }
  if ((facture.numero ?? '').startsWith('BR-')) {
    return NextResponse.json(
      { error: 'Ce document est un brouillon à numéro provisoire — émets-le d\'abord.' },
      { status: 400 },
    );
  }

  const { data: paramsRows } = await supabase.from('parametres').select('cle, valeur');
  const map: Record<string, string> = {};
  for (const p of (paramsRows ?? []) as Pick<Parametre, 'cle' | 'valeur'>[]) {
    map[p.cle] = p.valeur ?? '';
  }

  let xml: string;
  try {
    xml = buildUblXml(facture, supplierParamsFromMap(map));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Erreur génération UBL.' },
      { status: 400 },
    );
  }

  const body = new TextEncoder().encode(xml);
  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${facture.numero}.xml"`,
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'private, no-store, must-revalidate',
    },
  });
}
