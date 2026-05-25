import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from "@/lib/auth/server";

export const dynamic = 'force-dynamic';

// DELETE /api/admin/interventions/[id]/delete
//
// Soft delete : pose interventions.deleted_at = NOW(). Les interventions
// soft-deleted sont filtrées de toutes les queries de listage admin via
// `.is('deleted_at', null)`. Pas de cascade côté tables enfants —
// timeline / occupants / mails / liens restent intacts pour pouvoir
// restaurer plus tard si besoin.
//
// Ne touche pas à creneaux_disponibles : un créneau réservé conserve
// son lien intervention_id (la ligne supprimée existe toujours en DB).
// L'admin doit explicitement libérer le créneau si nécessaire via
// l'UI planning. À voir si on automatise plus tard.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { id } = await params;

  // Charge l'intervention pour log + retour de la ref
  const { data: iv, error: loadErr } = await supabase
    .from('interventions')
    .select('id, ref, deleted_at')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ ok: false, error: loadErr.message }, { status: 500 });
  if (!iv) return NextResponse.json({ ok: false, error: 'Intervention introuvable.' }, { status: 404 });
  if (iv.deleted_at) {
    return NextResponse.json({ ok: false, error: 'Intervention déjà supprimée.' }, { status: 410 });
  }

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const { error: updErr } = await admin
    .from('interventions')
    .update({ deleted_at: nowIso, updated_at: nowIso })
    .eq('id', id);
  if (updErr) {
    // Si la migration 2026-05-22 n'est pas appliquée, on tombe ici avec
    // 42703/PGRST204. Message explicite pour aider l'admin à diagnostiquer.
    const code = (updErr as { code?: string }).code ?? null;
    if (code === '42703' || code === 'PGRST204'
      || /does not exist/i.test(updErr.message)
      || /Could not find the .* column/i.test(updErr.message)
    ) {
      return NextResponse.json({
        ok: false,
        error: 'Colonne deleted_at absente — applique la migration 2026-05-22_intervention_soft_delete.sql.',
        code,
      }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
  }

  // Timeline best-effort
  try {
    await admin.from('intervention_timeline').insert({
      intervention_id: id,
      type: 'soft_delete',
      message: `🗑️ Intervention supprimée par ${user.email ?? 'admin'}`,
      payload: { deleted_at: nowIso, ref: iv.ref },
      created_by: user.email ?? 'admin',
    });
  } catch { /* noop */ }

  return NextResponse.json({ ok: true, deleted_ref: iv.ref, deleted_at: nowIso });
}
