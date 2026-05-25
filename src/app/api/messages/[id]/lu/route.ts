import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from "@/lib/auth/server";
import { getCurrentSyndic } from '@/lib/portal/syndic';

export const dynamic = 'force-dynamic';

// PATCH /api/messages/[id]/lu
//
// Marque le message comme lu côté du caller :
//   - admin → lu_admin = true
//   - syndic/courtier → lu_syndic = true
//
// La RLS UPDATE syndic_update_lu_messages autorise l'opération si
// l'intervention liée appartient à l'organisation du caller (cf.
// migration 2026-05-27_messages.sql, helper syndic_owns_intervention).
// Côté code, on ne touche QUE le flag lu_* concerné — pas de modif
// du contenu / auteur_*.
export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) {
    return NextResponse.json({ ok: false, error: 'Non connecté.' }, { status: 401 });
  }

  const { id } = await params;

  const isAdmin = await isAdminUser();
  let isPartner = false;
  if (!isAdmin) {
    const session = await getCurrentSyndic();
    if (!session?.org) {
      return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
    }
    isPartner = true;
  }

  const patch = isAdmin ? { lu_admin: true } : { lu_syndic: true };

  const { error } = await supabase
    .from('messages')
    .update(patch)
    .eq('id', id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Note : isPartner inutilisé en logique, conservé pour clarté (et pour
  // permettre une extension future où le rôle modulerait la réponse).
  void isPartner;
  return NextResponse.json({ ok: true });
}
