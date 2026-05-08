import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { roleForEmail } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

// PATCH /api/tech/facture/[id]
//
// Body : { ref_bon_commande?: string }
//
// Met à jour la « référence client » (PO du client) sur une facture
// brouillon. Côté DB on écrit sur factures.reference (la colonne
// ref_bon_commande n'existe que sur interventions ; le payload garde
// le nom ref_bon_commande pour cohérence sémantique côté UI).
//
// Restreint aux factures statut='brouillon' : une fois envoyée/payée
// la référence ne doit plus changer.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = roleForEmail(user?.email);
  const isTech = role === 'tech' || role === 'admin';
  const isTechDB = user
    ? await supabase
        .from('utilisateurs')
        .select('id')
        .eq('email', (user.email ?? '').toLowerCase())
        .eq('role', 'technicien')
        .maybeSingle()
        .then((r) => !!r.data)
    : false;
  if (!user || (!isTech && !isTechDB)) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

  const { id } = await params;

  let body: { ref_bon_commande?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }
  const ref = typeof body.ref_bon_commande === 'string'
    ? body.ref_bon_commande.trim().slice(0, 100)
    : '';

  // Service-role : RLS factures = is_admin only.
  const admin = createAdminClient();
  const { error } = await admin
    .from('factures')
    .update({ reference: ref || null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('statut', 'brouillon');

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
