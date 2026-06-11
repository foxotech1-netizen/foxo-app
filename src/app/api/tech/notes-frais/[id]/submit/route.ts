import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser, canAccessTechSpace } from "@/lib/auth/server";

export const dynamic = 'force-dynamic';

// POST /api/tech/notes-frais/[id]/submit
//
// Passe une note brouillon → soumise. Le tech ne peut soumettre que ses
// propres notes (ownership match technicien_email = auth.email). L'admin
// peut soumettre n'importe quelle note via cette même route.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isAdmin = await isAdminUser();
  // Accès tech via le rôle DB (utilisateurs.role), pas une whitelist d'emails.
  // canAccessTechSpace autorise technicien ET admin (parité avec l'historique).
  if (!user || !(await canAccessTechSpace(user.id))) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

  const { id } = await params;
  const email = (user.email ?? '').toLowerCase();
  const admin = createAdminClient();

  // Ownership : la note doit appartenir au tech connecté (sauf admin).
  const { data: row } = await admin
    .from('notes_frais')
    .select('technicien_email, statut')
    .eq('id', id)
    .maybeSingle();
  if (!row) return NextResponse.json({ ok: false, error: 'Note introuvable.' }, { status: 404 });
  if (!isAdmin && (row.technicien_email as string | null ?? '').toLowerCase() !== email) {
    return NextResponse.json({ ok: false, error: 'Note non assignée.' }, { status: 403 });
  }
  if (row.statut !== 'brouillon') {
    return NextResponse.json(
      { ok: false, error: `Statut actuel "${row.statut}" — soumission impossible.` },
      { status: 409 },
    );
  }

  const { error } = await admin
    .from('notes_frais')
    .update({ statut: 'soumise' })
    .eq('id', id)
    .eq('statut', 'brouillon');
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
