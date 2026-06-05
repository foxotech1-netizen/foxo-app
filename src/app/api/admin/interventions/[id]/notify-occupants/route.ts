import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from "@/lib/auth/server";
import { notifyOccupantsForIntervention } from '@/lib/occupants/notify-occupants';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface PostBody {
  occupant_ids?: unknown;            // requis — sous-ensemble des occupants à notifier
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { id } = await params;

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }
  const occupantIds = Array.isArray(body.occupant_ids)
    ? body.occupant_ids.filter((x): x is string => typeof x === 'string')
    : [];
  if (occupantIds.length === 0) {
    return NextResponse.json({ ok: false, error: 'Aucun occupant fourni.' }, { status: 400 });
  }

  // Cœur de l'envoi délégué au helper partagé (réutilisable hors HTTP).
  const result = await notifyOccupantsForIntervention(id, {
    occupantIds,
    sentBy: user.email ?? 'admin',
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    sent: result.sent,
    failed: result.failed,
    results: result.results,
  });
}
