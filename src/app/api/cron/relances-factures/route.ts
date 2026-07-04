// /api/cron/relances-factures — relances automatiques des factures impayées.
//
// ⚠️ VOLONTAIREMENT ABSENTE de vercel.json : aucun cron ne déclenche cette
// route aujourd'hui. L'activation (ajout d'une entrée cron OU appel par un
// workflow externe) est une décision future de Foxo — prérequis :
//   1. parametres.relances_auto_enabled = 'true' (sinon la route refuse) ;
//   2. délais validés dans parametres.relance_delais_jours ;
//   3. décision d'enregistrer le déclencheur (vercel.json ou GH Actions).
// En attendant, la page /admin/facturation/rappels offre le même moteur en
// déclenchement manuel (aperçu + envoi confirmé).
//
// GET  = aperçu dry-run (aucun envoi) ; POST = envoi réel (limit 20).
// Même patron de sécurité que les crons existants : Bearer CRON_SECRET.

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAutomationJob } from '@/lib/observability';
import { runRelancesAuto } from '@/lib/facturation/relances';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function checkAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${expected}`;
}

async function relancesEnabled(): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('parametres')
    .select('valeur')
    .eq('cle', 'relances_auto_enabled')
    .maybeSingle();
  return data?.valeur === 'true';
}

// Aperçu dry-run : liste les relances dues sans rien envoyer.
export async function GET(request: Request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!(await relancesEnabled())) {
    return NextResponse.json(
      { ok: false, error: 'relances_auto_enabled off — activez l\'interrupteur dans Paramètres.' },
      { status: 403 },
    );
  }
  const result = await runRelancesAuto({ dryRun: true });
  return NextResponse.json({ ok: true, dry_run: true, candidates: result.candidates });
}

type RelancesOutcome =
  | { kind: 'skipped'; reason: string }
  | { kind: 'success'; envoyees: number; candidates: number; erreurs: number };

export async function POST(request: Request) {
  // Guard Bearer hors wrap (un refus 401 n'est pas un job) — idem rappel-j1.
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const job = await logAutomationJob<RelancesOutcome>({
    automationName: 'relances_factures',
    run: async () => {
      if (!(await relancesEnabled())) {
        return {
          output: { kind: 'skipped' as const, reason: 'relances_auto_enabled off' },
          result: { reason: 'relances_auto_enabled off' },
          status: 'skipped' as const,
        };
      }
      const result = await runRelancesAuto({ dryRun: false, limit: 20 });
      return {
        output: {
          kind: 'success' as const,
          envoyees: result.envoyees,
          candidates: result.candidates.length,
          erreurs: result.erreurs.length,
        },
        result: {
          candidates: result.candidates.length,
          envoyees: result.envoyees,
          erreurs: result.erreurs,
        },
      };
    },
  });

  if (job.status === 'failed') {
    return NextResponse.json(
      { ok: false, status: 'failed', log_id: job.logId },
      { status: 500 },
    );
  }
  if (job.output.kind === 'skipped') {
    return NextResponse.json({ ok: true, skipped: true, reason: job.output.reason, log_id: job.logId });
  }
  return NextResponse.json({
    ok: true,
    log_id: job.logId,
    candidates: job.output.candidates,
    envoyees: job.output.envoyees,
    erreurs: job.output.erreurs,
  });
}
