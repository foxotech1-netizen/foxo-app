/**
 * src/app/api/cron/ingest-cas-terrain/route.ts
 *
 * Déclencheur HTTP du runner d'ingestion batch (chantier « Assistant
 * terrain », étape 4). Appelé toutes les 5 minutes par un workflow GitHub
 * Actions (le plan Vercel Hobby limite les crons natifs à 1/jour) —
 * même patron de sécurité que /api/cron/rappel-j1 : Bearer CRON_SECRET.
 *
 * Interrupteur : parametres.ingestion_cas_terrain ('true'/'false') —
 * démarrage, pause et arrêt se font en SQL, sans toucher Vercel ni GitHub.
 * Dossier source : parametres.ingestion_cas_terrain_folder_id.
 *
 * Quand plus rien ne reste à traiter, le job se marque 'skipped' (aucun
 * appel modèle) : le workflow peut continuer à sonner sans coût.
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAutomationJob } from '@/lib/observability';
import {
  runIngestBatch,
  type IngestBatchResult,
} from '@/lib/agents/extraction-cas/ingest-batch';

export const dynamic = 'force-dynamic';
// 3 extractions (~50 s pièce) + listing Drive + lectures d'état : plafond
// maximum standard, cohérent avec la route extract-test (cf. PR #139).
export const maxDuration = 300;

function checkAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${expected}`;
}

type IngestOutcome =
  | { kind: 'skipped'; reason: string }
  | { kind: 'success'; result: IngestBatchResult };

export async function POST(request: Request) {
  // Guard Bearer hors wrap (un refus 401 n'est pas un job) — idem rappel-j1.
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const job = await logAutomationJob<IngestOutcome>({
    automationName: 'ingest_cas_terrain',
    run: async () => {
      const admin = createAdminClient();

      const { data: toggle } = await admin
        .from('parametres')
        .select('valeur')
        .eq('cle', 'ingestion_cas_terrain')
        .maybeSingle();
      if (toggle?.valeur !== 'true') {
        return {
          output: { kind: 'skipped' as const, reason: 'ingestion_cas_terrain off' },
          result: { reason: 'ingestion_cas_terrain off' },
          status: 'skipped' as const,
        };
      }

      const { data: folder } = await admin
        .from('parametres')
        .select('valeur')
        .eq('cle', 'ingestion_cas_terrain_folder_id')
        .maybeSingle();
      const folderId = (folder?.valeur ?? '').trim();
      if (!folderId) {
        return {
          output: { kind: 'skipped' as const, reason: 'folder_id manquant' },
          result: { reason: 'folder_id manquant' },
          status: 'skipped' as const,
        };
      }

      // runIngestBatch throw → laisse remonter, le wrapper logue 'failed'.
      const result = await runIngestBatch(folderId);

      // Fonds épuisé : lot vide, rien tenté → 'skipped' (lisibilité
      // automation_jobs : la fin de chantier se voit d'un coup d'œil).
      const exhausted =
        result.processed === 0 && result.failed === 0 && result.remaining === 0;

      return {
        output: { kind: 'success' as const, result },
        result: {
          processed: result.processed,
          failed: result.failed,
          remaining: result.remaining,
          set_aside: result.setAside,
          total_pdf: result.totalPdf,
          cost_eur_cents: result.costEurCents,
        },
        status: exhausted ? ('skipped' as const) : ('success' as const),
      };
    },
  });

  if (job.status === 'failed') {
    return NextResponse.json(
      { ok: false, status: 'failed', log_id: job.logId, duration_ms: job.durationMs },
      { status: 500 },
    );
  }
  if (job.output.kind === 'skipped') {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: job.output.reason,
      log_id: job.logId,
    });
  }
  return NextResponse.json({
    ok: true,
    status: job.status,
    log_id: job.logId,
    duration_ms: job.durationMs,
    ...job.output.result,
  });
}
