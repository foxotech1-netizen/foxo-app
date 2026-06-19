// POST /api/admin/mails/occupant-response/confirm
// Body : { thread_id: string, occupant_id: string }
// Response : { success: true, applied, skippedReason? }
//
// Phase 4 U4 — confirmation MANUELLE 1-clic d'un occupant depuis la carte de
// validation de la FicheDossierCard (niveaux 'probable' / 'ambigu'). Aucune
// confirmation n'est appliquée sans ce clic admin. Le helper U3a est idempotent
// (ne réécrase pas un statut déjà tranché) et journalise dans la timeline.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from '@/lib/auth/server';
import { getOccupantResponseMatch } from '@/lib/occupants/occupant-response-context';
import { confirmOccupantFromMail } from '@/lib/occupants/confirm-from-mail';

export const dynamic = 'force-dynamic';

interface ConfirmBody {
  thread_id?: unknown;
  occupant_id?: unknown;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ success: false, error: 'Accès refusé.' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as ConfirmBody;
  const threadId = typeof body.thread_id === 'string' ? body.thread_id.trim() : '';
  const occupantId = typeof body.occupant_id === 'string' ? body.occupant_id.trim() : '';
  if (!threadId || !occupantId) {
    return NextResponse.json(
      { success: false, error: 'thread_id et occupant_id requis.' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Recharge le contexte côté serveur (ne fait jamais confiance au client pour
  // l'intention ni le dossier).
  const ctx = await getOccupantResponseMatch(admin, threadId);
  if (!ctx.found) {
    return NextResponse.json(
      { success: false, error: 'Aucune réponse occupant exploitable pour ce fil.' },
      { status: 400 },
    );
  }

  // DÉFENSE : l'occupant ciblé doit appartenir au dossier lié à ce thread.
  const { data: occ } = await admin
    .from('occupants')
    .select('id, intervention_id')
    .eq('id', occupantId)
    .maybeSingle();
  const occRow = occ as { id: string; intervention_id: string } | null;
  if (!occRow || occRow.intervention_id !== ctx.dossierId) {
    return NextResponse.json(
      { success: false, error: 'Occupant hors du dossier lié à ce fil.' },
      { status: 400 },
    );
  }

  const result = await confirmOccupantFromMail(admin, {
    occupantId,
    threadId,
    intention: ctx.match.intention,
    raison: 'Confirmé manuellement par l’admin depuis le mail',
    source: 'mail_admin',
    actorId: user.id,
  });

  return NextResponse.json({
    success: true,
    applied: result.applied,
    skippedReason: result.skippedReason,
  });
}
