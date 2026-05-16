import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runCheckMails } from '@/lib/cron/check-mails';
import { logAutomationJob } from '@/lib/observability';

export const dynamic = 'force-dynamic';
// Plafond Vercel — sans ça, la fonction peut être tuée à 10s
// (default Hobby plan) avant que les mails soient analysés.
export const maxDuration = 60;

function checkBearer(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return (req.headers.get('authorization') ?? '') === `Bearer ${expected}`;
}

// Discriminé pour que la couche HTTP au-dessus distingue skip vs run effectif
// sans avoir à inspecter le jsonb persisté en automation_jobs.result. Le run
// success ramène le résultat complet de runCheckMails (avec items[]) au caller
// pour le bouton « Vérifier maintenant », mais automation_jobs.result ne
// persiste que les compteurs agrégés (cf. ci-dessous).
type CheckMailsOutcome =
  | { kind: 'skipped'; reason: string }
  | { kind: 'success'; result: Awaited<ReturnType<typeof runCheckMails>> };

async function handle(request: Request): Promise<Response> {
  // Guard Bearer : un refus 401 n'est PAS un job — hors wrap logAutomationJob.
  if (!checkBearer(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const job = await logAutomationJob<CheckMailsOutcome>({
    automationName: 'check_mails',
    run: async () => {
      // Toggle parametres.mail_auto_analyse — désactive le cron sans
      // toucher à Vercel. Si la lecture échoue, on laisse remonter :
      // mieux vaut un job 'failed' visible dans automation_jobs qu'un
      // run silencieux avec une config inconnue.
      const admin = createAdminClient();
      const { data } = await admin
        .from('parametres')
        .select('valeur')
        .eq('cle', 'mail_auto_analyse')
        .maybeSingle();
      if (data?.valeur !== 'true') {
        return {
          output: { kind: 'skipped', reason: 'mail_auto_analyse off' },
          result: { reason: 'mail_auto_analyse off' },
          status: 'skipped',
        };
      }

      // runCheckMails throw → laisse remonter, le wrapper logue 'failed'.
      const result = await runCheckMails(false);
      return {
        output: { kind: 'success', result },
        // Compteurs uniquement — la liste items[] reste dans output (renvoyée
        // au caller pour le bouton manuel) mais n'est pas dupliquée dans
        // automation_jobs.result pour ne pas bloater la table.
        result: {
          processed: result.processed,
          created: result.created,
          labeled_lu: result.labeled_lu,
          skipped: result.skipped,
          errors: result.errors,
        },
      };
    },
  });

  if (job.output.kind === 'skipped') {
    return NextResponse.json({ ok: true, skipped: true, reason: job.output.reason });
  }
  return NextResponse.json({ ok: true, logId: job.logId, ...job.output.result });
}

// Vercel cron pousse en GET ; le bouton "Vérifier maintenant" pousse en POST.
export async function GET(request: Request) { return handle(request); }
export async function POST(request: Request) { return handle(request); }
