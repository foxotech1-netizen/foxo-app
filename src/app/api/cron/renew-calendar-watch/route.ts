import { NextResponse } from 'next/server';
import {
  subscribeCalendarWatch,
  unsubscribeCalendarWatch,
} from '@/lib/google-calendar';
import {
  loadWatchState,
  saveWatchState,
} from '@/lib/calendar-watch-state';
import { logAutomationJob } from '@/lib/observability';

export const dynamic = 'force-dynamic';

// Cron quotidien (GitHub Actions, 6h UTC). Pas d'auth user — Bearer
// CRON_SECRET partagé.
//
// Comportement :
//   - Pas de subscription en DB                   → en crée une (action: 'created')
//   - Expire dans <24h ou déjà expiré             → renouvelle (action: 'renewed')
//   - Expire dans >24h                            → skip       (action: 'skipped')
function checkBearer(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return (req.headers.get('authorization') ?? '') === `Bearer ${expected}`;
}

// 3-outcomes uniquement : les échecs Google upstream sont throw depuis run()
// (cf. décision design étape 5c) → le wrapper logue 'failed' avec
// error_message capturé. La HTTP layer attrape via try/catch et renvoie 500
// structuré. Trade-off assumé : régression 502 → 500 sur les outcomes
// historiquement failed (non-consommé en pratique).
type Subscription = { channel_id: string; resource_id: string; expiry_ms: number };
type RenewCalendarWatchOutcome =
  | { kind: 'created'; subscription: Subscription }
  | { kind: 'skipped_valid' }
  | { kind: 'renewed'; subscription: Subscription };

async function handle(request: Request): Promise<Response> {
  // Guard Bearer : un refus 401 n'est PAS un job — hors wrap logAutomationJob.
  // Payload préservé tel quel (inconsistance { ok: false, error } vs les
  // autres crons { error } notée mais non-bloquante).
  if (!checkBearer(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const job = await logAutomationJob<RenewCalendarWatchOutcome>({
      automationName: 'renew_calendar_watch',
      run: async () => {
        // Env vars : pas d'early-return 500 hors wrap — on throw pour que
        // l'opérateur voie le run 'failed' dans automation_jobs (le wrapper
        // capte l'exception et renseigne error_message).
        const appUrl = process.env.NEXT_PUBLIC_APP_URL;
        const token = process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN;
        if (!appUrl) throw new Error('Missing env var NEXT_PUBLIC_APP_URL');
        if (!token) throw new Error('Missing env var GOOGLE_CALENDAR_WEBHOOK_TOKEN');
        const webhookUrl = `${appUrl.replace(/\/$/, '')}/api/google/calendar-webhook`;

        const state = await loadWatchState();
        const now = Date.now();
        const HOUR24 = 24 * 60 * 60 * 1000;
        const hasActive = Boolean(state.channel_id && state.resource_id) && state.expiry_ms > 0;
        const expiringSoon = hasActive && state.expiry_ms - now < HOUR24;

        // Cas 1 : pas de subscription → en créer une
        if (!hasActive) {
          const sub = await subscribeCalendarWatch({ webhookUrl, token });
          if (!sub.ok) throw new Error(`Google subscribe failed (created): ${sub.error}`);
          await saveWatchState({
            channel_id: sub.subscription.channel_id,
            resource_id: sub.subscription.resource_id,
            expiry_ms: sub.subscription.expiry_ms,
          });
          return {
            output: {
              kind: 'created',
              subscription: {
                channel_id: sub.subscription.channel_id,
                resource_id: sub.subscription.resource_id,
                expiry_ms: sub.subscription.expiry_ms,
              },
            },
            result: {
              action: 'created',
              new_expiry: sub.subscription.expiry_ms,
              new_expiry_iso: new Date(sub.subscription.expiry_ms).toISOString(),
              channel_id: sub.subscription.channel_id,
              resource_id: sub.subscription.resource_id,
            },
            action: 'created',
          };
        }

        // Cas 2 : encore valide >24h → skip métier
        // Note: 'skipped' ici a une sémantique différente des autres crons (check_mails, rappel_j1).
        // Pas un toggle admin off, mais un skip légitime métier (watch Google encore valide >24h).
        if (!expiringSoon) {
          return {
            output: { kind: 'skipped_valid' },
            result: {
              action: 'skipped',
              current_expiry: state.expiry_ms,
              current_expiry_iso: new Date(state.expiry_ms).toISOString(),
              ms_remaining: state.expiry_ms - now,
            },
            status: 'skipped',
            action: 'skipped_valid',
          };
        }

        // Cas 3 : expiring → stop ancien channel (best-effort) puis créer le nouveau
        if (state.channel_id && state.resource_id) {
          const stop = await unsubscribeCalendarWatch({
            channelId: state.channel_id,
            resourceId: state.resource_id,
          });
          if (!stop.ok) {
            // On log mais on continue — le channel peut déjà être mort côté Google
            console.warn('[cron/renew-calendar-watch] stop ancien channel échoué :', stop.error);
          }
        }

        const sub = await subscribeCalendarWatch({ webhookUrl, token });
        if (!sub.ok) {
          // L'ancien est déjà arrêté → on vide pour permettre une retry au prochain cron
          await saveWatchState({ channel_id: null, resource_id: null, expiry_ms: 0 });
          throw new Error(`Google subscribe failed (renewed): ${sub.error}`);
        }
        await saveWatchState({
          channel_id: sub.subscription.channel_id,
          resource_id: sub.subscription.resource_id,
          expiry_ms: sub.subscription.expiry_ms,
        });
        return {
          output: {
            kind: 'renewed',
            subscription: {
              channel_id: sub.subscription.channel_id,
              resource_id: sub.subscription.resource_id,
              expiry_ms: sub.subscription.expiry_ms,
            },
          },
          result: {
            action: 'renewed',
            new_expiry: sub.subscription.expiry_ms,
            new_expiry_iso: new Date(sub.subscription.expiry_ms).toISOString(),
            channel_id: sub.subscription.channel_id,
            resource_id: sub.subscription.resource_id,
          },
          action: 'renewed',
        };
      },
    });

    // Dispatch HTTP sur outcomes de succès. L'action externe 'skipped' reste
    // identique au comportement historique (compat consumer GitHub Actions
    // / dashboard), même si l'output interne est 'skipped_valid' (pour
    // distinguer du skip-toggle-off des autres crons).
    if (job.output.kind === 'created') {
      return NextResponse.json({
        ok: true,
        action: 'created',
        subscription: job.output.subscription,
        logId: job.logId,
      });
    }
    if (job.output.kind === 'renewed') {
      return NextResponse.json({
        ok: true,
        action: 'renewed',
        subscription: job.output.subscription,
        logId: job.logId,
      });
    }
    return NextResponse.json({ ok: true, action: 'skipped', logId: job.logId });
  } catch (err) {
    // Toutes les exceptions remontent ici (Google upstream fail, DB throw,
    // env var manquante). Le wrapper a déjà inséré une ligne 'failed' dans
    // automation_jobs avec error_message renseigné — logId perdu côté
    // caller, retrouvable par timestamp dans la table.
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) { return handle(request); }
export async function GET(request: Request)  { return handle(request); }
