// POST /api/admin/mails/link-to-intervention
// Body : { thread_id: string, intervention_id: string | null }
// Response : { success: true, dossier: { id, ref } | null }
//
// Lien manuel fil ↔ dossier (Mails V2 Phase 3 — U3) : écrit
// mails_analyses.dossier_match_id depuis la FicheDossierCard.
// intervention_id null = délier. AUCUNE écriture intervention_mails
// (writer réservé au cron check-mails).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

interface LinkBody {
  thread_id?: unknown;
  intervention_id?: unknown;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ success: false, error: 'Accès refusé.' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as LinkBody;
  const threadId = typeof body.thread_id === 'string' ? body.thread_id.trim() : '';
  const interventionId = typeof body.intervention_id === 'string' && body.intervention_id.trim()
    ? body.intervention_id.trim()
    : body.intervention_id === null ? null : undefined;
  if (!threadId || interventionId === undefined) {
    return NextResponse.json(
      { success: false, error: 'thread_id requis, intervention_id requis (string ou null pour délier).' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // La ligne mails_analyses doit exister : le lien vit dessus.
  const { data: analyseRow, error: anaErr } = await admin
    .from('mails_analyses')
    .select('thread_id')
    .eq('thread_id', threadId)
    .maybeSingle();
  if (anaErr) return NextResponse.json({ success: false, error: anaErr.message }, { status: 500 });
  if (!analyseRow) {
    return NextResponse.json(
      { success: false, error: 'Fil non analysé — lance d’abord l’analyse IA.' },
      { status: 404 },
    );
  }

  // Si on lie : l'intervention cible doit exister.
  let dossier: { id: string; ref: string | null } | null = null;
  if (interventionId !== null) {
    const { data: iv, error: ivErr } = await admin
      .from('interventions')
      .select('id, ref')
      .eq('id', interventionId)
      .maybeSingle();
    if (ivErr) return NextResponse.json({ success: false, error: ivErr.message }, { status: 500 });
    if (!iv) {
      return NextResponse.json(
        { success: false, error: 'Intervention introuvable.' },
        { status: 404 },
      );
    }
    dossier = iv as { id: string; ref: string | null };
  }

  const { error: upErr } = await admin
    .from('mails_analyses')
    .update({ dossier_match_id: interventionId, updated_at: new Date().toISOString() })
    .eq('thread_id', threadId);
  if (upErr) return NextResponse.json({ success: false, error: upErr.message }, { status: 500 });

  return NextResponse.json({ success: true, dossier });
}
