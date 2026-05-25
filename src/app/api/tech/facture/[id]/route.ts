import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { roleForEmail } from '@/lib/auth/roles';
import { isAdminUser } from "@/lib/auth/server";
import type { FactureLigne } from '@/lib/types/database';

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
  const isTech = role === 'tech' || (await isAdminUser());
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

  let body: {
    ref_bon_commande?: unknown;
    client_nom?: unknown;
    client_email?: unknown;
    client_adresse?: unknown;
    lignes?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }

  // Build patch incrémental — on n'écrit que les champs fournis. Les
  // chaînes vides après trim deviennent null (clear). Les lignes
  // déclenchent un recalcul des montants HT/TVA/TTC.
  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body.ref_bon_commande === 'string') {
    updateData.reference = body.ref_bon_commande.trim().slice(0, 100) || null;
  }
  if (typeof body.client_nom === 'string') {
    updateData.client_nom = body.client_nom.trim().slice(0, 200) || null;
  }
  if (typeof body.client_email === 'string') {
    updateData.client_email = body.client_email.trim().slice(0, 200) || null;
  }
  if (typeof body.client_adresse === 'string') {
    updateData.client_adresse = body.client_adresse.trim().slice(0, 500) || null;
  }
  if (Array.isArray(body.lignes) && body.lignes.length > 0) {
    const lignes = body.lignes as FactureLigne[];
    const ht = Math.round(lignes.reduce((s, l) => s + l.prix_unitaire * l.quantite, 0) * 100) / 100;
    const tva = Math.round(
      lignes.reduce((s, l) => s + (l.prix_unitaire * l.quantite * l.tva_pct) / 100, 0) * 100,
    ) / 100;
    updateData.lignes = lignes;
    updateData.montant_ht = ht;
    updateData.montant_tva = tva;
    updateData.montant_ttc = Math.round((ht + tva) * 100) / 100;
  }

  // Service-role : RLS factures = is_admin only.
  const admin = createAdminClient();
  const { error } = await admin
    .from('factures')
    .update(updateData)
    .eq('id', id)
    .eq('statut', 'brouillon');

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
