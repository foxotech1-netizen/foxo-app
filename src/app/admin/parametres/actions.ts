'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from "@/lib/auth/server";
import { runCheckMails } from '@/lib/cron/check-mails';

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

async function assertAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return { ok: false, error: 'Accès refusé.' };
  }
  return { ok: true };
}

// "Vérifier maintenant" → exécute le cron côté serveur (sans exposer
// CRON_SECRET au client). Le toggle parametres.mail_auto_analyse n'est
// PAS contrôlé ici : l'admin a explicitement cliqué.
export async function triggerCheckMailsNow(): Promise<ActionResult<{
  processed: number; created: number; labeled_lu: number; skipped: number; errors: number;
  errorItems: { subject: string; error: string }[];
}>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  try {
    const result = await runCheckMails(false);
    revalidatePath('/admin');
    revalidatePath('/admin/parametres');
    return {
      ok: true,
      data: {
        processed: result.processed,
        created: result.created,
        labeled_lu: result.labeled_lu,
        skipped: result.skipped,
        errors: result.errors,
        // Détail des erreurs (sujet + raison) pour affichage immédiat dans
        // l'UI — sans ça l'admin ne voit qu'un compteur « N erreur(s) » nu.
        errorItems: result.items
          .filter((it) => it.action === 'error')
          .map((it) => ({
            subject: it.subject || '(sans sujet)',
            error: it.error ?? 'Erreur inconnue',
          })),
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur inconnue' };
  }
}

// ─── Calendar Watch — actions admin ──────────────────────────────────────
//
// Encapsulent les routes /api/google/calendar-watch/* pour pouvoir être
// appelées depuis le client sans exposer le CRON_SECRET ou les tokens
// Google. La logique réelle est dans les helpers lib/google-calendar +
// lib/calendar-watch-state — on les appelle directement plutôt que de
// faire un fetch interne.

import { subscribeCalendarWatch, unsubscribeCalendarWatch } from '@/lib/google-calendar';
import {
  loadWatchState,
  saveWatchState,
  clearWatchState,
  watchStatus,
  type WatchState,
} from '@/lib/calendar-watch-state';

export interface CalendarWatchStatus {
  status: 'inactive' | 'active' | 'expiring_soon' | 'expired';
  channel_id: string | null;
  resource_id: string | null;
  expiry_ms: number;
  expiry_iso: string | null;
}

function statusFromState(s: WatchState): CalendarWatchStatus {
  return {
    status: watchStatus(s),
    channel_id: s.channel_id,
    resource_id: s.resource_id,
    expiry_ms: s.expiry_ms,
    expiry_iso: s.expiry_ms > 0 ? new Date(s.expiry_ms).toISOString() : null,
  };
}

export async function getCalendarWatchStatus(): Promise<ActionResult<CalendarWatchStatus>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  const state = await loadWatchState();
  return { ok: true, data: statusFromState(state) };
}

export async function subscribeCalendarWatchAction(): Promise<ActionResult<CalendarWatchStatus>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return { ok: false, error: 'NEXT_PUBLIC_APP_URL non défini.' };
  const token = process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN;
  if (!token) return { ok: false, error: 'GOOGLE_CALENDAR_WEBHOOK_TOKEN non défini.' };

  const webhookUrl = `${appUrl.replace(/\/$/, '')}/api/google/calendar-webhook`;
  const sub = await subscribeCalendarWatch({ webhookUrl, token });
  if (!sub.ok) return { ok: false, error: sub.error };

  const state: WatchState = {
    channel_id: sub.subscription.channel_id,
    resource_id: sub.subscription.resource_id,
    expiry_ms: sub.subscription.expiry_ms,
  };
  const saved = await saveWatchState(state);
  if (!saved.ok) return { ok: false, error: saved.error };
  revalidatePath('/admin/parametres');
  return { ok: true, data: statusFromState(state) };
}

export async function unsubscribeCalendarWatchAction(): Promise<ActionResult<CalendarWatchStatus>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  const state = await loadWatchState();
  if (state.channel_id && state.resource_id) {
    await unsubscribeCalendarWatch({
      channelId: state.channel_id,
      resourceId: state.resource_id,
    });
  }
  await clearWatchState();
  revalidatePath('/admin/parametres');
  const next = await loadWatchState();
  return { ok: true, data: statusFromState(next) };
}

export async function renewCalendarWatchAction(): Promise<ActionResult<CalendarWatchStatus>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return { ok: false, error: 'NEXT_PUBLIC_APP_URL non défini.' };
  const token = process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN;
  if (!token) return { ok: false, error: 'GOOGLE_CALENDAR_WEBHOOK_TOKEN non défini.' };
  const webhookUrl = `${appUrl.replace(/\/$/, '')}/api/google/calendar-webhook`;

  // Stop ancien (best-effort) + crée nouveau
  const state = await loadWatchState();
  if (state.channel_id && state.resource_id) {
    await unsubscribeCalendarWatch({
      channelId: state.channel_id,
      resourceId: state.resource_id,
    });
  }
  const sub = await subscribeCalendarWatch({ webhookUrl, token });
  if (!sub.ok) {
    await clearWatchState();
    return { ok: false, error: sub.error };
  }
  const next: WatchState = {
    channel_id: sub.subscription.channel_id,
    resource_id: sub.subscription.resource_id,
    expiry_ms: sub.subscription.expiry_ms,
  };
  await saveWatchState(next);
  revalidatePath('/admin/parametres');
  return { ok: true, data: statusFromState(next) };
}

// Lit parametres.mail_last_check (pour rafraîchir l'UI après le clic).
export async function getMailLastCheck(): Promise<ActionResult<{ value: string | null }>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from('parametres')
      .select('valeur')
      .eq('cle', 'mail_last_check')
      .maybeSingle();
    return { ok: true, data: { value: data?.valeur ?? null } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur inconnue' };
  }
}
