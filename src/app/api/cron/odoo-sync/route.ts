// /api/cron/odoo-sync — passage NOCTURNE du miroir Odoo → FoxO (lecture seule
// côté Odoo).
//
// Déclenché par Vercel Cron (vercel.json). Même patron de sécurité que les
// autres crons : Bearer CRON_SECRET. Inerte tant que
// parametres.odoo_lecture_active !== 'true' : on allume l'interrupteur après
// un premier passage manuel réussi (/api/admin/facturation/odoo-sync).

import { NextResponse } from 'next/server';
import { logAutomationJob } from '@/lib/observability';
import { odooLectureActive, synchroniserOdoo } from '@/lib/facturation/odoo-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function checkAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return (req.headers.get('authorization') ?? '') === `Bearer ${expected}`;
}

type OdooSyncOutcome =
  | { kind: 'skipped'; reason: string }
  | { kind: 'success'; result: Record<string, unknown> };

async function handle(request: Request): Promise<Response> {
  // Un refus 401 n'est PAS un job — hors wrap logAutomationJob.
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const job = await logAutomationJob<OdooSyncOutcome>({
      automationName: 'odoo_sync',
      run: async () => {
        if (!(await odooLectureActive())) {
          return {
            output: { kind: 'skipped', reason: 'odoo_lecture_active off' },
            result: { reason: 'odoo_lecture_active off' },
            status: 'skipped',
          };
        }
        const resultat = await synchroniserOdoo('planifie', null);
        // Échec → throw : le wrapper logue un job 'failed' visible dans
        // automation_jobs (le détail est aussi dans odoo_synchronisations).
        if (!resultat.ok) throw new Error(resultat.erreur);
        const result = { ...resultat };
        return { output: { kind: 'success', result }, result };
      },
    });

    if (job.output.kind === 'skipped') {
      return NextResponse.json({ ok: true, skipped: true, reason: job.output.reason });
    }
    return NextResponse.json({ logId: job.logId, ...job.output.result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

// Vercel Cron appelle en GET ; POST accepté pour un déclenchement manuel outillé.
export async function GET(request: Request) { return handle(request); }
export async function POST(request: Request) { return handle(request); }
