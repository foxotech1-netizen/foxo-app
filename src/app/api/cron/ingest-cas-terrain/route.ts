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
 * Plafond budgétaire : parametres.ingestion_cas_terrain_max (nb de fiches
 * max en base ; vide ou 0 = illimité) — arrêt automatique, même si
 * l'interrupteur reste sur 'true'.
 * Périmètre d'années : parametres.ingestion_cas_terrain_annees (CSV,
 * ex. '2023,2024,2025' ; vide = toutes) — filtre sur le début du nom de
 * fichier, conformément à la convention de nommage du fonds.
 * Taille de lot : parametres.ingestion_cas_terrain_batch (nb de fiches par
 * passage ; défaut 3, borné 1..12 côté runner pour tenir sous maxDuration).
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

      // Plafond budgétaire : parametres.ingestion_cas_terrain_max (nombre de
      // fiches). Atteint → 'skipped' sans lister Drive ni appeler le modèle.
      // Vide, absent ou 0 → pas de plafond. Le pilote démarre à 200.
      const { data: maxRow } = await admin
        .from('parametres')
        .select('valeur')
        .eq('cle', 'ingestion_cas_terrain_max')
        .maybeSingle();
      const maxFiches = Number.parseInt((maxRow?.valeur ?? '').trim(), 10);
      if (Number.isFinite(maxFiches) && maxFiches > 0) {
        const { count, error: countError } = await admin
          .from('cas_terrain')
          .select('*', { count: 'exact', head: true });
        if (countError) {
          throw new Error(`Comptage cas_terrain : ${countError.message}`);
        }
        if ((count ?? 0) >= maxFiches) {
          return {
            output: {
              kind: 'skipped' as const,
              reason: `plafond atteint (${count ?? 0}/${maxFiches} fiches)`,
            },
            result: { reason: 'plafond atteint', fiches: count ?? 0, plafond: maxFiches },
            status: 'skipped' as const,
          };
        }
      }

      const { data: anneesRow } = await admin
        .from('parametres')
        .select('valeur')
        .eq('cle', 'ingestion_cas_terrain_annees')
        .maybeSingle();
      const allowedYears = String(anneesRow?.valeur ?? '')
        .split(',')
        .map((y: string) => y.trim())
        .filter(Boolean);

      const { data: batchRow } = await admin
        .from('parametres')
        .select('valeur')
        .eq('cle', 'ingestion_cas_terrain_batch')
        .maybeSingle();
      const parsedBatch = Number.parseInt((batchRow?.valeur ?? '').trim(), 10);
      const batchSize = Number.isFinite(parsedBatch) && parsedBatch > 0 ? parsedBatch : undefined;

      // runIngestBatch throw → laisse remonter, le wrapper logue 'failed'.
      const result = await runIngestBatch(folderId, { allowedYears, batchSize });

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
