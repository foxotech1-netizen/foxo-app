import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

// GET /api/admin/interventions/[id]/liens
// Renvoie les dossiers liés + mails liés pour cette intervention.
// Utilisé par le drawer pour afficher les sections "🔗 Dossiers liés"
// et "📧 Mails liés".
//
// Si les tables 2026-05-20 ne sont pas appliquées, les sections
// sont vides — le drawer continue de fonctionner.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { id } = await params;

  // Liens — on récupère les enregistrements où cette intervention est
  // côté gauche (intervention_id), puis on jointe les infos de la liée.
  type LienRow = {
    type_lien: 'meme_dossier' | 'suivi' | 'doublon' | 'related';
    source: 'auto' | 'manuel';
    note: string | null;
    created_at: string;
    liee: { id: string; ref: string | null; statut: string; updated_at: string } | { id: string; ref: string | null; statut: string; updated_at: string }[] | null;
  };
  let liens: Array<{
    type_lien: string;
    source: string;
    note: string | null;
    created_at: string;
    liee_id: string;
    liee_ref: string | null;
    liee_statut: string;
    liee_updated_at: string;
  }> = [];
  try {
    const { data, error } = await supabase
      .from('intervention_liens')
      .select('type_lien, source, note, created_at, liee:interventions!intervention_liens_intervention_liee_id_fkey(id, ref, statut, updated_at)')
      .eq('intervention_id', id)
      .order('created_at', { ascending: false });
    if (!error && data) {
      liens = (data as unknown as LienRow[]).map((r) => {
        const l = Array.isArray(r.liee) ? r.liee[0] : r.liee;
        return {
          type_lien: r.type_lien,
          source: r.source,
          note: r.note,
          created_at: r.created_at,
          liee_id: l?.id ?? '',
          liee_ref: l?.ref ?? null,
          liee_statut: l?.statut ?? '',
          liee_updated_at: l?.updated_at ?? '',
        };
      }).filter((l) => l.liee_id);
    }
  } catch { /* table peut ne pas exister — migration pending */ }

  // Mails liés à cette intervention
  type MailRow = {
    id: string;
    gmail_message_id: string;
    from_email: string | null;
    from_name: string | null;
    subject: string | null;
    date: string | null;
    snippet: string | null;
    type_mail: string;
    created_at: string;
  };
  let mails: MailRow[] = [];
  try {
    const { data } = await supabase
      .from('intervention_mails')
      .select('id, gmail_message_id, from_email, from_name, subject, date, snippet, type_mail, created_at')
      .eq('intervention_id', id)
      .order('date', { ascending: false, nullsFirst: false });
    if (data) mails = data as MailRow[];
  } catch { /* noop */ }

  return NextResponse.json({ ok: true, liens, mails });
}
