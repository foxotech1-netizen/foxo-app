/**
 * src/app/api/admin/facturation/odoo-brouillon/essai/route.ts
 *
 * Essai À BLANC du brouillon Odoo d'un dossier : montre exactement ce que
 * FoxO enverrait à Odoo (client retrouvé ou à créer, référence, lignes,
 * note, valeurs account.move) SANS RIEN ENVOYER. Admin uniquement. Testable
 * depuis la barre d'adresse par un admin connecté :
 *   GET /api/admin/facturation/odoo-brouillon/essai?ref=2026-000
 *
 * Lectures seules vers Odoo (catalogue, recherche du client), journalisées
 * dans odoo_appels. Aucune écriture, quel que soit l'état de l'interrupteur.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from '@/lib/auth/server';
import { essaiABlanc } from '@/lib/facturation/odoo-brouillon';

export const dynamic = 'force-dynamic';
// Quelques appels de lecture, espacés d'une seconde.
export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 401 });
  }

  const ref = (new URL(request.url).searchParams.get('ref') ?? '').trim();
  if (!/^\d{4}-\d{3,}$/.test(ref)) {
    return NextResponse.json({ ok: false, error: 'Paramètre ref attendu (ex. ?ref=2026-000).' }, { status: 400 });
  }
  const { data: iv } = await createAdminClient()
    .from('interventions')
    .select('id')
    .eq('ref', ref)
    .is('deleted_at', null)
    .maybeSingle();
  const interventionId = (iv as { id: string } | null)?.id;
  if (!interventionId) {
    return NextResponse.json({ ok: false, error: `Dossier ${ref} introuvable.` }, { status: 404 });
  }

  try {
    const essai = await essaiABlanc(interventionId, user.email ?? null);
    return NextResponse.json(
      { ok: true, lecture_seule: true, rien_envoye: true, ...essai },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, lecture_seule: true, rien_envoye: true, error: e instanceof Error ? e.message : String(e) },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
