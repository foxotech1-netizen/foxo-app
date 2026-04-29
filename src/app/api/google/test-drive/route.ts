import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';
import { testDriveConnection } from '@/lib/google-drive';

export const dynamic = 'force-dynamic';

// Vérifie l'accès aux 2 dossiers racines Drive (RAPPORTS + FACTURES).
// Renvoie { rapports: {ok, name?, error?, status?}, factures: {...} }.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const result = await testDriveConnection();
  return NextResponse.json({ ok: true, ...result });
}
