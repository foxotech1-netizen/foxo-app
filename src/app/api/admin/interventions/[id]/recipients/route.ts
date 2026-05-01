import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';
import { getEmailForDoc, type DocType } from '@/lib/notifications';
import type { Acp, Organisation, ParticulierContact } from '@/lib/types/database';

export const dynamic = 'force-dynamic';

// GET /api/admin/interventions/[id]/recipients
// Renvoie les destinataires email résolus pour facture / rapport /
// communication, avec la source du choix (acp / syndic / acp_legacy /
// syndic_general / particulier).

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

  // SELECT complet (avec colonnes ajoutées par 2026-05-14_emails_syndic.sql)
  let iv: unknown = null;
  let error: { code?: string; message: string; details?: string; hint?: string } | null = null;
  {
    const r = await supabase
      .from('interventions')
      .select(`
        id, particulier_contact, acp_id, syndic_id,
        syndic:organisations(id, nom, email, email_factures, email_rapports, email_communications),
        acp:acps(id, nom, email_facturation, email_rapport, email_factures, email_rapports, email_communications)
      `)
      .eq('id', id)
      .maybeSingle();
    iv = r.data;
    error = r.error;
  }

  // Fallback : si colonnes new emails dédiés manquantes, retry SELECT legacy
  if (error) {
    console.error('[recipients GET] supabase error', {
      intervention_id: id,
      code: error.code ?? null,
      message: error.message,
      details: error.details ?? null,
      hint: error.hint ?? null,
    });
    const code = error.code;
    const colMissing = code === '42703' || /column .* does not exist/i.test(error.message);
    if (colMissing) {
      console.warn('[recipients GET] fallback to legacy emails — apply migration 2026-05-14_emails_syndic.sql');
      const r2 = await supabase
        .from('interventions')
        .select(`
          id, particulier_contact, acp_id, syndic_id,
          syndic:organisations(id, nom, email),
          acp:acps(id, nom, email_facturation, email_rapport)
        `)
        .eq('id', id)
        .maybeSingle();
      if (r2.error) {
        console.error('[recipients GET] legacy fallback failed', r2.error);
        return NextResponse.json({ ok: false, error: r2.error.message }, { status: 500 });
      }
      iv = r2.data;
    } else {
      return NextResponse.json({ ok: false, error: error.message, code: code ?? null }, { status: 500 });
    }
  }
  if (!iv) return NextResponse.json({ ok: false, error: 'Intervention introuvable.' }, { status: 404 });

  // Le join Supabase peut renvoyer un objet ou un tableau selon la cardinalité.
  type RawRow = {
    particulier_contact: ParticulierContact | null;
    acp_id: string | null;
    syndic_id: string | null;
    syndic: Organisation | Organisation[] | null;
    acp: Acp | Acp[] | null;
  };
  const r = iv as unknown as RawRow;
  const syndic = Array.isArray(r.syndic) ? (r.syndic[0] ?? null) : r.syndic;
  const acp = Array.isArray(r.acp) ? (r.acp[0] ?? null) : r.acp;

  const docs: DocType[] = ['facture', 'rapport', 'communication'];
  const recipients = docs.map((d) => ({
    doc: d,
    ...getEmailForDoc({ acp, syndic, particulier_contact: r.particulier_contact }, d),
  }));

  return NextResponse.json({
    ok: true,
    recipients,
    acp_id: acp?.id ?? null,
    syndic_id: syndic?.id ?? null,
  });
}
