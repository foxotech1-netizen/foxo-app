import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { canAccessTechSpace } from "@/lib/auth/server";

export const dynamic = 'force-dynamic';

// GET /api/tech/articles
//
// Retourne le catalogue d'articles actifs (pour la sélection côté tech
// dans le PaiementPanel). Auth identique aux autres routes /api/tech :
// tech whitelist, admin, ou utilisateurs.role = 'technicien'.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Accès tech via le rôle DB (utilisateurs.role), pas une whitelist d'emails.
  // canAccessTechSpace autorise technicien ET admin (parité avec l'historique).
  if (!user || !(await canAccessTechSpace(user.id))) {
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
