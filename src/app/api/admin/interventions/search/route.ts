// GET /api/admin/interventions/search?q=...
// Réponse : { success: true, results: [{ id, ref, adresse }] }
//
// Autocomplete pour le formulaire "Lier à un dossier existant" (UI
// MailAnalyseActions cas 2). Filtre fuzzy ILIKE sur ref + adresse,
// exclut les dossiers clôturés. Limite stricte à 10 résultats pour
// rester réactif côté client.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from "@/lib/auth/server";

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ success: false, error: 'Accès refusé.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  // Évite un scan full-table sur query vide ou ultra-courte (< 2 chars).
  if (q.length < 2) return NextResponse.json({ success: true, results: [] });

  const admin = createAdminClient();
  const pattern = `%${q}%`;
  const { data, error } = await admin
    .from('interventions')
    .select('id, ref, adresse')
    .is('deleted_at', null)
    .or(`ref.ilike.${pattern},adresse.ilike.${pattern}`)
    .neq('statut', 'cloturee')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, results: data ?? [] });
}
