// GET /api/admin/mails/analyses?thread_ids=tid1,tid2,...
// Réponse : { success: true, analyses: Record<thread_id, MailAnalyse> }
//
// Lecture batch des analyses Claude pour le mount du composant
// MailsClient — évite N requêtes individuelles par thread visible.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { roleForEmail } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ success: false, error: 'Accès refusé.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const raw = url.searchParams.get('thread_ids') ?? '';
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 200); // Plafond pour éviter une URL/requête abusive

  if (ids.length === 0) {
    return NextResponse.json({ success: true, analyses: {} });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('mails_analyses')
    .select('*')
    .in('thread_id', ids);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const analyses: Record<string, unknown> = {};
  for (const row of data ?? []) {
    const tid = (row as { thread_id?: string }).thread_id;
    if (tid) analyses[tid] = row;
  }
  return NextResponse.json({ success: true, analyses });
}
