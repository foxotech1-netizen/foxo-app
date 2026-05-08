import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { roleForEmail } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

// GET /api/tech/articles
//
// Retourne le catalogue d'articles actifs (pour la sélection côté tech
// dans le PaiementPanel). Auth identique aux autres routes /api/tech :
// tech whitelist, admin, ou utilisateurs.role = 'technicien'.
export async function GET() {
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

  // Service-role : RLS articles peut limiter le SELECT aux admins.
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('articles')
    .select('id, code, description, prix_htva, tva_pct')
    .eq('actif', true)
    .order('description', { ascending: true });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, articles: data ?? [] });
}
