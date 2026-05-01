import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { roleForEmail } from '@/lib/auth/roles';
import { createInterventionLien, type CronDoublonType } from '@/lib/cron/check-mails';

export const dynamic = 'force-dynamic';

const ALLOWED_TYPES: CronDoublonType[] = ['meme_dossier', 'suivi', 'doublon', 'related'];

interface LierBody {
  intervention_liee_id?: unknown;
  type_lien?: unknown;
  note?: unknown;
}

// POST /api/admin/interventions/[id]/lier
// Crée un lien manuel bidirectionnel entre cette intervention et une
// autre. La détection automatique (doublon, suivi) reste pilotée par
// le cron check-mails ; ici c'est l'admin qui force le lien.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { id } = await params;

  let body: LierBody;
  try {
    body = (await request.json()) as LierBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }

  const liee = typeof body.intervention_liee_id === 'string' ? body.intervention_liee_id : '';
  const typeLienRaw = typeof body.type_lien === 'string' ? body.type_lien : '';
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;
  if (!liee) {
    return NextResponse.json({ ok: false, error: 'intervention_liee_id requis.' }, { status: 400 });
  }
  if (liee === id) {
    return NextResponse.json({ ok: false, error: 'Impossible de lier une intervention à elle-même.' }, { status: 400 });
  }
  if (!(ALLOWED_TYPES as string[]).includes(typeLienRaw)) {
    return NextResponse.json({ ok: false, error: `type_lien invalide. Valeurs : ${ALLOWED_TYPES.join(', ')}.` }, { status: 400 });
  }
  const typeLien = typeLienRaw as CronDoublonType;

  // Vérifie que les deux interventions existent
  const { data: ivs, error: lookupErr } = await supabase
    .from('interventions')
    .select('id, ref')
    .in('id', [id, liee]);
  if (lookupErr) {
    return NextResponse.json({ ok: false, error: lookupErr.message }, { status: 500 });
  }
  if (!ivs || ivs.length !== 2) {
    return NextResponse.json({ ok: false, error: 'Une des deux interventions est introuvable.' }, { status: 404 });
  }
  const target = ivs.find((v: { id: string; ref: string | null }) => v.id === liee) as { id: string; ref: string | null } | undefined;

  await createInterventionLien({
    intervention_id: id,
    intervention_liee_id: liee,
    type_lien: typeLien,
    source: 'manuel',
    note,
  });

  // Timeline sur les deux côtés (best-effort, non bloquant)
  try {
    const admin = createAdminClient();
    const targetRef = target?.ref ?? '?';
    await admin.from('intervention_timeline').insert([
      {
        intervention_id: id,
        type: 'lien_manuel',
        message: `🔗 Lié manuellement à ${targetRef} (${typeLien})`,
        payload: { liee_id: liee, type_lien: typeLien, note },
        created_by: user.email ?? 'admin',
      },
      {
        intervention_id: liee,
        type: 'lien_manuel',
        message: `🔗 Lié manuellement par ${user.email ?? 'admin'} (${typeLien})`,
        payload: { liee_id: id, type_lien: typeLien, note },
        created_by: user.email ?? 'admin',
      },
    ]);
  } catch { /* noop — table peut être absente si migration pending */ }

  return NextResponse.json({ ok: true });
}
