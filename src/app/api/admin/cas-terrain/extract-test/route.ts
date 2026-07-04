/**
 * src/app/api/admin/cas-terrain/extract-test/route.ts
 *
 * Route de VALIDATION de l'agent extraction_cas (chantier Assistant terrain,
 * étape 3). Admin uniquement. Prend l'ID Drive d'UN rapport PDF, le télécharge,
 * lance l'extraction et renvoie la fiche JSON pour inspection humaine.
 *
 * Deux méthodes, même logique :
 *  - GET  ?drive_file_id=...&persist=1  → testable depuis la barre d'adresse
 *    du navigateur par un admin connecté (méthode de validation FoxO).
 *  - POST { drive_file_id, persist }    → pour l'outillage futur.
 *
 * `persist` (défaut false) : si vrai, upsert idempotent dans `cas_terrain`
 * (clé source_ref = drive_file_id). Le défaut à false permet d'inspecter la
 * fiche AVANT toute écriture.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from '@/lib/auth/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  downloadDrivePdfBase64,
  extractCasTerrain,
  EXTRACTION_MODEL,
} from '@/lib/agents/extraction-cas';

export const dynamic = 'force-dynamic';
// Téléchargement Drive + lecture PDF complet par le modèle : le premier test
// réel a pris ~50 s et un second appel a dépassé 60 s (504 Vercel). Plafond
// porté au maximum standard (300 s) pour absorber la variance.
export const maxDuration = 300;

async function runExtractTest(driveFileId: string, persist: boolean): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 401 });
  }

  if (!driveFileId) {
    return NextResponse.json(
      { ok: false, error: 'drive_file_id requis.' },
      { status: 400 },
    );
  }

  // 1) Téléchargement du PDF depuis Drive.
  const dl = await downloadDrivePdfBase64(driveFileId);
  if (!dl.ok) {
    return NextResponse.json(
      { ok: false, step: 'drive_download', error: dl.error },
      { status: 502 },
    );
  }

  // 2) Extraction (runAgent → agent_logs, y compris en cas d'erreur).
  let extraction;
  try {
    extraction = await extractCasTerrain({
      pdfBase64: dl.base64,
      sourceRef: driveFileId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, step: 'extraction', error: msg },
      { status: 500 },
    );
  }

  // 3) Persistance optionnelle — upsert idempotent (rejouable sans doublon).
  let persisted = false;
  if (persist) {
    const admin = createAdminClient();
    const { error } = await admin.from('cas_terrain').upsert(
      {
        source_ref: driveFileId,
        annee: extraction.fiche.annee,
        qualite_source: extraction.fiche.qualite_source,
        statut_fuite: extraction.fiche.statut_fuite,
        contexte: extraction.fiche.contexte,
        symptome: extraction.fiche.symptome,
        symptome_resume: extraction.fiche.symptome_resume,
        techniques: extraction.fiche.techniques,
        raisonnement: extraction.fiche.raisonnement,
        conclusion: extraction.fiche.conclusion,
        recommandation: extraction.fiche.recommandation,
        preuves_visuelles: extraction.fiche.preuves_visuelles,
        confiance: extraction.fiche.confiance,
        extrait_par: EXTRACTION_MODEL,
        a_relire: extraction.aRelire,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'source_ref' },
    );
    if (error) {
      return NextResponse.json(
        { ok: false, step: 'persist', error: error.message, fiche: extraction.fiche },
        { status: 500 },
      );
    }
    persisted = true;
  }

  return NextResponse.json({
    ok: true,
    persisted,
    a_relire: extraction.aRelire,
    conf_min: extraction.confMin,
    cost_eur_cents: extraction.costEurCents,
    duration_ms: extraction.durationMs,
    log_id: extraction.logId,
    pdf_kb: Math.round(dl.sizeBytes / 1024),
    fiche: extraction.fiche,
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const driveFileId = (url.searchParams.get('drive_file_id') ?? '').trim();
  const persistParam = (url.searchParams.get('persist') ?? '').trim().toLowerCase();
  const persist = persistParam === '1' || persistParam === 'true';
  return runExtractTest(driveFileId, persist);
}

type ExtractTestBody = {
  drive_file_id?: unknown;
  persist?: unknown;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as ExtractTestBody;
  const driveFileId =
    typeof body.drive_file_id === 'string' ? body.drive_file_id.trim() : '';
  const persist = body.persist === true;
  return runExtractTest(driveFileId, persist);
}
