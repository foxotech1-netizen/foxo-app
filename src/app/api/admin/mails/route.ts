import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from "@/lib/auth/server";
import { listInboxMails } from '@/lib/gmail';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Force toute couche de cache (browser, CDN Vercel, fetch RSC) à ne
// rien stocker. Sans ça, "↻ Actualiser" peut servir un payload obsolète.
const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
};

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json(
      { ok: false, error: 'Accès refusé.' },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const url = new URL(request.url);
  // Default 50 (au lieu de 30) — on peut toujours réduire via ?limit=
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '50', 10) || 50;
  const limit = Math.min(Math.max(1, limitRaw), 100);    // borne dure
  const filter = url.searchParams.get('filter');
  const label = url.searchParams.get('label');
  // Construit la query Gmail. trash et inbox sont exclusifs.
  const parts: string[] = [];
  if (filter === 'trash') {
    parts.push('in:trash');
  } else {
    parts.push('in:inbox');
    if (filter === 'unread') parts.push('is:unread');
  }
  if (label) parts.push(`label:"${label.replace(/"/g, '')}"`);
  const q = parts.join(' ');

  const res = await listInboxMails({ limit, q });
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: res.error },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
  return NextResponse.json(
    { ok: true, mails: res.mails },
    { headers: NO_STORE_HEADERS },
  );
}
