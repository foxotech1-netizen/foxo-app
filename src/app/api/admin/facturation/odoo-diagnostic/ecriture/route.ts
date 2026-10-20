/**
 * src/app/api/admin/facturation/odoo-diagnostic/ecriture/route.ts
 *
 * Diagnostic Odoo « volet écriture » en LECTURE SEULE (chantier « créer les
 * factures de vente dans Odoo depuis FoxO »). Admin uniquement. Testable
 * depuis la barre d'adresse du navigateur par un admin connecté :
 * GET /api/admin/facturation/odoo-diagnostic/ecriture
 *
 * Ramène ce qu'Odoo exige pour une facture de vente brouillon (champs,
 * journaux, taxes, comptes, valeurs par défaut) et quelques factures
 * récentes avec lignes et tiers. N'écrit ni dans Odoo ni dans la base FoxO.
 * Ne dépend PAS de l'interrupteur parametres.odoo_sync_enabled.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from '@/lib/auth/server';
import { runOdooDiagnosticEcriture } from '@/lib/facturation/odoo-diagnostic-ecriture';

export const dynamic = 'force-dynamic';
// Une quinzaine d'appels de lecture, espacés d'une seconde.
export const maxDuration = 60;

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 401 });
  }

  const rapport = await runOdooDiagnosticEcriture();
  return NextResponse.json(rapport, { headers: { 'Cache-Control': 'no-store' } });
}
