import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from "@/lib/auth/server";
import { getCalendarChanges } from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';

// Lit (ou initialise) le syncToken global puis applique les changements
// Calendar sur la table creneaux_disponibles. Idempotent — peut être
// appelé manuellement (au chargement de /admin/planning) ou par cron.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: tokRow } = await admin
    .from('parametres')
    .select('valeur')
    .eq('cle', 'gcal_sync_token')
    .maybeSingle();
  const currentToken = (tokRow?.valeur as string | null) ?? null;

  let token = currentToken;
  let pulled = 0;
  let appliedDeletes = 0;

  // Loop sur les pages
  while (true) {
    const r = await getCalendarChanges(token, undefined);
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 502 });

    if (r.full_sync_required) {
      // Token expiré → on force un re-init (sans token)
      token = null;
      continue;
    }

    pulled += r.events.length;

    // Pour chaque événement, si on a un creneau lié via google_event_id
    // et qu'il est marqué 'cancelled' (status), on libère le créneau.
    for (const ev of r.events) {
      const status = (ev as unknown as { status?: string }).status;
      if (status === 'cancelled') {
        const { data: matched } = await admin
          .from('creneaux_disponibles')
          .select('id, statut')
          .eq('google_event_id', ev.id)
          .maybeSingle();
        if (matched) {
          await admin
            .from('creneaux_disponibles')
            .delete()
            .eq('id', matched.id)
            .eq('statut', 'libre');
          appliedDeletes++;
        }
      }
    }

    if (!r.next_page_token) {
      // Sauvegarde le syncToken final
      if (r.next_sync_token) {
        await admin
          .from('parametres')
          .upsert(
            { cle: 'gcal_sync_token', valeur: r.next_sync_token, updated_at: new Date().toISOString() },
            { onConflict: 'cle' },
          );
      }
      break;
    }
    token = r.next_page_token;
  }

  return NextResponse.json({ ok: true, pulled, applied_deletes: appliedDeletes });
}
