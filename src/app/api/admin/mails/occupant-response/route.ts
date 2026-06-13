// GET /api/admin/mails/occupant-response?thread_id=...
// Response : { found, niveau, intention, raison, occupantSur, candidats }
//
// Phase 4 U4 — alimente la carte de validation manuelle de la FicheDossierCard.
// Lecture seule : rejoue le moteur de matching U2 (via le loader partagé) sur
// les occupants réels du dossier lié. Ne renvoie JAMAIS analyse_raw ; les
// occupants sont réduits aux seuls champs utiles à l'UI.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from '@/lib/auth/server';
import { getOccupantResponseMatch } from '@/lib/occupants/occupant-response-context';
import type { OccupantForMatch } from '@/lib/occupants/match-mail-response';

export const dynamic = 'force-dynamic';

// Projection UI minimale d'un occupant (jamais d'autres colonnes).
function toUiOccupant(o: OccupantForMatch) {
  return {
    id: o.id,
    prenom: o.prenom,
    nom: o.nom,
    email: o.email,
    appartement: o.appartement,
    etage: o.etage,
    conf: o.conf,
  };
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ success: false, error: 'Accès refusé.' }, { status: 403 });
  }

  const url = new URL(request.url);
  const threadId = (url.searchParams.get('thread_id') ?? '').trim();
  if (!threadId) {
    return NextResponse.json({ success: false, error: 'thread_id requis.' }, { status: 400 });
  }

  const admin = createAdminClient();
  const ctx = await getOccupantResponseMatch(admin, threadId);

  if (!ctx.found) {
    return NextResponse.json({ success: true, found: false });
  }

  const { match } = ctx;
  return NextResponse.json({
    success: true,
    found: true,
    niveau: match.niveau,
    intention: match.intention,
    raison: match.raison,
    occupantSur: match.occupantSur ? toUiOccupant(match.occupantSur) : null,
    candidats: match.candidats.map(toUiOccupant),
  });
}
