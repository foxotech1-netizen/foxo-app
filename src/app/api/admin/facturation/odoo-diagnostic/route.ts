/**
 * src/app/api/admin/facturation/odoo-diagnostic/route.ts
 *
 * État des lieux Odoo en LECTURE SEULE (chantier « Odoo visible dans FoxO »).
 * Admin uniquement. Testable depuis la barre d'adresse du navigateur par un
 * admin connecté : GET /api/admin/facturation/odoo-diagnostic
 *
 * Ne lit que des compteurs, des noms de champs et quelques pièces récentes
 * sans tiers. N'écrit ni dans Odoo ni dans la base FoxO. Ne dépend PAS de
 * l'interrupteur parametres.odoo_sync_enabled (qui gouverne le push).
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from '@/lib/auth/server';
import { runOdooDiagnostic } from '@/lib/facturation/odoo-diagnostic';

export const dynamic = 'force-dynamic';
// Une cinquantaine d'appels de lecture courts vers Odoo.
export const maxDuration = 60;

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 401 });
  }

  const rapport = await runOdooDiagnostic();
  return NextResponse.json(rapport, { headers: { 'Cache-Control': 'no-store' } });
}
