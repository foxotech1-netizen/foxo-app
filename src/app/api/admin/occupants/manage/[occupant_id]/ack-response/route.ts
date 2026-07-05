import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

// POST /api/admin/occupants/manage/[occupant_id]/ack-response
//
// Marque la réponse d'un occupant comme "vue" par l'admin : pose
// occupants.reponse_vue_at = now(). Sert à retirer la réponse de la carte
// "Réponses occupants reçues (< 48 h)" du tableau de bord sans attendre
// l'expiration automatique à 48 h.
//
// Volontairement SILENCIEUX : aucun email, aucun changement de statut, aucune
// écriture dans occupant_responses_log — ce n'est pas une réponse occupant,
// c'est un accusé de lecture côté admin. Si le même occupant répond à nouveau
// plus tard, son confirmed_at redevient > reponse_vue_at et la réponse
// réapparaît (filtrage dans /admin/page.tsx et /admin/interventions/page.tsx).

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ occupant_id: string }> },
) {
  // 1. Auth (client cookie) — admin uniquement.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { occupant_id } = await params;

  const admin = createAdminClient();

  // 2. Mutation : accusé de lecture. Idempotent par nature (réappliquer
  //    n'avance que l'horodatage). Le filtre .eq borne à l'occupant visé ;
  //    0 ligne touchée = occupant supprimé entre-temps, sans erreur.
  const { error: updateErr } = await admin
    .from('occupants')
    .update({ reponse_vue_at: new Date().toISOString() })
    .eq('id', occupant_id);
  if (updateErr) {
    return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
