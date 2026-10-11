/**
 * src/app/api/admin/facturation/odoo-sync/route.ts
 *
 * Miroir Odoo → FoxO (lecture seule côté Odoo) : état et lancement MANUEL.
 * Admin uniquement.
 *
 *  - GET  …/odoo-sync            → état du miroir (volumes, derniers passages).
 *    N'appelle pas Odoo.
 *  - GET  …/odoo-sync?lancer=1   → lance un passage puis renvoie son bilan.
 *    Testable depuis la barre d'adresse du navigateur par un admin connecté
 *    (méthode de validation FoxO).
 *  - POST …/odoo-sync            → lance un passage (bouton de l'écran).
 *
 * Un passage écrit UNIQUEMENT dans odoo_factures, odoo_mouvements_bancaires
 * et odoo_synchronisations — jamais dans les factures FoxO, jamais dans Odoo.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from '@/lib/auth/server';
import { etatSynchronisation, synchroniserOdoo } from '@/lib/facturation/odoo-sync';

export const dynamic = 'force-dynamic';
// Une poignée de lectures Odoo espacées d'une seconde, puis l'écriture du miroir.
export const maxDuration = 120;

const SANS_CACHE = { headers: { 'Cache-Control': 'no-store' } };

// Renvoie l'e-mail de l'admin connecté, ou null si l'accès est refusé.
async function adminConnecte(): Promise<{ email: string | null } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) return null;
  return { email: user.email ?? null };
}

async function lancer(email: string | null): Promise<NextResponse> {
  const resultat = await synchroniserOdoo('manuel', email);
  try {
    return NextResponse.json({ resultat, etat: await etatSynchronisation() }, SANS_CACHE);
  } catch (e) {
    return NextResponse.json(
      { resultat, etat: { erreur: e instanceof Error ? e.message : String(e) } },
      SANS_CACHE,
    );
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const admin = await adminConnecte();
  if (!admin) return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 401 });

  if (new URL(request.url).searchParams.get('lancer') === '1') {
    return lancer(admin.email);
  }
  try {
    return NextResponse.json({ etat: await etatSynchronisation() }, SANS_CACHE);
  } catch (e) {
    return NextResponse.json(
      { etat: { erreur: e instanceof Error ? e.message : String(e) } },
      SANS_CACHE,
    );
  }
}

export async function POST(): Promise<NextResponse> {
  const admin = await adminConnecte();
  if (!admin) return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 401 });
  return lancer(admin.email);
}
