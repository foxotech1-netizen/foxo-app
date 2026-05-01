import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

// PATCH /api/tech/interventions/[id]/notes
// Body : { notes_tech: string }
// Sauvegarde le bloc-notes interne du tech (auto-save debounced 2s
// côté UI). Vérifie que le tech est bien assigné à l'intervention.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'tech') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { id } = await params;

  // Vérifie l'ownership : le tech connecté doit être assigné à cette
  // intervention (sinon il pourrait écrire sur le carnet d'un collègue).
  const { data: u } = await supabase
    .from('utilisateurs')
    .select('id')
    .eq('email', (user.email ?? '').toLowerCase())
    .maybeSingle();
  if (!u) {
    return NextResponse.json({ ok: false, error: 'Compte tech inconnu.' }, { status: 404 });
  }
  const { data: iv } = await supabase
    .from('interventions')
    .select('id, technicien_id')
    .eq('id', id)
    .maybeSingle();
  if (!iv) {
    return NextResponse.json({ ok: false, error: 'Intervention introuvable.' }, { status: 404 });
  }
  if (iv.technicien_id !== u.id) {
    return NextResponse.json({ ok: false, error: 'Tu n\'es pas assigné à cette intervention.' }, { status: 403 });
  }

  let body: { notes_tech?: unknown };
  try {
    body = await request.json() as { notes_tech?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }
  // Accepte string ou null. On limite à 50k chars pour éviter qu'un
  // bug client ne pousse un blob énorme.
  const notes = typeof body.notes_tech === 'string'
    ? body.notes_tech.slice(0, 50_000)
    : body.notes_tech === null ? null : null;

  const { error } = await supabase
    .from('interventions')
    .update({ notes_tech: notes, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    // Si la migration 2026-05-19 n'est pas appliquée, on signale clairement
    const code = (error as { code?: string }).code;
    if (code === '42703' || /column .* does not exist/i.test(error.message)) {
      return NextResponse.json({
        ok: false,
        error: 'Colonne notes_tech absente — applique la migration 2026-05-19_tech_notes.sql.',
        code,
      }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, saved_at: new Date().toISOString() });
}
