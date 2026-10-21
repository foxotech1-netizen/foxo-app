/**
 * src/app/api/admin/facturation/odoo/reconstruction/route.ts
 *
 * Reconstruction des dossiers FoxO depuis le miroir Odoo — phase 1.
 * Admin uniquement. Jamais d'exécution implicite : le mode est explicite.
 *
 *  - POST { mode: 'verifier' }
 *      → vérification à blanc : un verdict par numéro de dossier, AUCUNE écriture.
 *  - POST { mode: 'executer', refs: string[] }   (20 numéros au plus)
 *      → crée les dossiers « a_creer » parmi ces numéros (verdict recalculé
 *        juste avant), relie leurs factures du miroir, renvoie le journal.
 *
 * Aucune écriture vers Odoo, aucun dossier existant modifié, aucune ACP ni
 * organisation créée (cf. odoo-reconstruction.ts).
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from '@/lib/auth/server';
import {
  MAX_REFS_PAR_APPEL,
  executerReconstruction,
  planifierReconstruction,
} from '@/lib/facturation/odoo-reconstruction';

export const dynamic = 'force-dynamic';
// Quelques lectures Supabase, puis jusqu'à 20 créations séquentielles.
export const maxDuration = 60;

const SANS_CACHE = { headers: { 'Cache-Control': 'no-store' } };

function refuser(error: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error }, { status, ...SANS_CACHE });
}

export async function POST(request: Request): Promise<NextResponse> {
  // Même garde que les autres routes /api/admin/* (import, odoo-sync).
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) return refuser('Accès refusé.', 403);

  const body = (await request.json().catch(() => null)) as { mode?: unknown; refs?: unknown } | null;
  const mode = body?.mode;

  try {
    if (mode === 'verifier') {
      const plan = await planifierReconstruction();
      return NextResponse.json({ ok: true, mode, ...plan }, SANS_CACHE);
    }
    if (mode === 'executer') {
      const refs = Array.isArray(body?.refs)
        ? body.refs.filter((r): r is string => typeof r === 'string' && r.trim() !== '')
        : [];
      if (refs.length === 0) return refuser('refs[] requis (numéros de dossier à créer).', 400);
      if (refs.length > MAX_REFS_PAR_APPEL) {
        return refuser(`${MAX_REFS_PAR_APPEL} numéros au plus par appel (envoi par paquets côté client).`, 400);
      }
      const journal = await executerReconstruction(refs);
      return NextResponse.json({ ok: true, mode, journal }, SANS_CACHE);
    }
    return refuser("mode attendu : 'verifier' ou 'executer'.", 400);
  } catch (e) {
    return refuser(e instanceof Error ? e.message : String(e), 500);
  }
}
