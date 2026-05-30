import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

// POST /api/admin/occupants/manage/[occupant_id]/erase
// Droit a l'oubli RGPD : anonymise un occupant partout (fiche occupant +
// analyses de mails + logs SMS) via la fonction SQL verrouillee
// rgpd_erase_occupant, et journalise l'operation dans rgpd_erasure_logs.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ occupant_id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !(await isAdminUser())) {
      return NextResponse.json({ ok: false, error: 'Acces refuse.' }, { status: 403 });
    }

    const { occupant_id } = await params;
    if (!occupant_id) {
      return NextResponse.json({ ok: false, error: 'Identifiant occupant manquant.' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin.rpc('rgpd_erase_occupant', {
      p_occupant_id: occupant_id,
      p_erased_by: user.email ?? user.id,
    });

    if (error) {
      console.error('[RGPD] rgpd_erase_occupant erreur:', error.message);
      return NextResponse.json({ ok: false, error: "L'effacement RGPD a echoue." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, log: data });
  } catch (e) {
    console.error('[RGPD] erase route exception:', e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: 'Erreur serveur.' }, { status: 500 });
  }
}
