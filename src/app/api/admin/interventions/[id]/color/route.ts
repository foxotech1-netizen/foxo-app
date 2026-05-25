import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from "@/lib/auth/server";

export const dynamic = 'force-dynamic';

// 10 couleurs validées côté client (palette planning). Tout autre input
// est rejeté pour éviter les écritures arbitraires.
const ALLOWED_COLORS = new Set([
  '#1B3A6B', '#1F6B45', '#C4622D', '#7C3AED', '#DB2777',
  '#D97706', '#0891B2', '#6B7280', '#4338CA', '#059669',
]);

interface PatchBody {
  color?: unknown;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { id } = await params;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }

  // null/empty/undefined → reset (couleur par défaut)
  let color: string | null = null;
  if (typeof body.color === 'string' && body.color) {
    if (!ALLOWED_COLORS.has(body.color.toUpperCase())) {
      return NextResponse.json({ ok: false, error: 'Couleur non autorisée.' }, { status: 400 });
    }
    color = body.color.toUpperCase();
  }

  const { error } = await supabase
    .from('interventions')
    .update({ color, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, color });
}
