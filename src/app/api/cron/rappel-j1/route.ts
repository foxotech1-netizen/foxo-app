import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runRappelJ1 } from '@/lib/cron/rappel-j1';
import { logAutomationJob } from '@/lib/observability';

export const dynamic = 'force-dynamic';

function checkAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${expected}`;
}

// Discriminé pour que la couche HTTP au-dessus distingue skip vs run effectif
// sans inspecter le jsonb persisté en automation_jobs.result.
type RappelJ1Outcome =
  | { kind: 'skipped'; reason: string }
  | { kind: 'success'; result: Awaited<ReturnType<typeof runRappelJ1>>['result'] };

export async function POST(request: Request) {
  // Guard Bearer : un refus 401 n'est PAS un job — hors wrap logAutomationJob
  // pour ne pas gonfler automation_jobs avec des tentatives non-auth.
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const job = await logAutomationJob<RappelJ1Outcome>({
    automationName: 'rappel_j1',
    run: async () => {
      // Toggle parametres.sms_auto_rappel_24h — désactive le cron sans
      // toucher à Vercel. Si la lecture échoue, on laisse remonter :
      // mieux vaut un job 'failed' visible dans automation_jobs qu'un
      // run silencieux avec une config inconnue (cohérent avec 5a check_mails).
      const admin = createAdminClient();
      const { data } = await admin
        .from('parametres')
        .select('valeur')
        .eq('cle', 'sms_auto_rappel_24h')
        .maybeSingle();
      if (data?.valeur !== 'true') {
        return {
          output: { kind: 'skipped', reason: 'sms_auto_rappel_24h off' },
          result: { reason: 'sms_auto_rappel_24h off' },
          status: 'skipped',
        };
      }

      // runRappelJ1 throw → laisse remonter, le wrapper logue 'failed'.
      const { result } = await runRappelJ1(false);
      return {
        // CronResult est petit ({ sent, skipped, errors[] }) et errors[] ne
        // contient que { occupant_id, error } sans PII textuelle — persistable
        // tel quel dans automation_jobs.result. Object literal explicite car
        // l'interface CronResult n'a pas d'index signature implicite et
        // n'est pas directement assignable à Record<string, unknown>.
        output: { kind: 'success', result },
        result: { sent: result.sent, skipped: result.skipped, errors: result.errors },
      };
    },
  });

  if (job.output.kind === 'skipped') {
    return NextResponse.json({ ok: true, skipped: true, reason: job.output.reason });
  }
  // Note: 'skipped' au niveau job (boolean) et result.skipped (compteur d'occupants dédoublonnés) sont
  // deux notions distinctes ; elles ne coexistent jamais dans la même réponse HTTP.
  return NextResponse.json({ ok: true, logId: job.logId, ...job.output.result });
}
