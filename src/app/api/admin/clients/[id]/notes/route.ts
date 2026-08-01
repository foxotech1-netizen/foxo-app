// GET/POST /api/admin/clients/[id]/notes — notes d'appel du client
// (Mode Appel phase 4). Table notes_appel : RLS FORCE sans policy →
// service-role uniquement, d'où createAdminClient derrière la garde admin
// (même pattern que les autres routes /api/admin/*).
//
// GET  : { ok: true, notes: [...] } — 50 dernières, ref du dossier lié résolue.
// POST : { contenu, intervention_id? } → insert + événement best-effort
//        'note_appel' dans intervention_timeline quand un dossier est lié.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

const MAX_NOTES = 50;
const MAX_CONTENU = 2000;
const TIMELINE_MSG_MAX = 120;

export interface NoteAppel {
  id: string;
  client_id: string;
  intervention_id: string | null;
  intervention_ref: string | null;
  contenu: string;
  created_by: string | null;
  created_at: string;
}

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) return null;
  return user;
}

type NoteRow = Omit<NoteAppel, 'intervention_ref'>;

async function withRefs(rows: NoteRow[]): Promise<NoteAppel[]> {
  const admin = createAdminClient();
  const ivIds = Array.from(new Set(rows.map((n) => n.intervention_id).filter(Boolean) as string[]));
  const refById = new Map<string, string | null>();
  if (ivIds.length > 0) {
    const { data } = await admin.from('interventions').select('id, ref').in('id', ivIds);
    for (const r of (data ?? []) as { id: string; ref: string | null }[]) refById.set(r.id, r.ref);
  }
  return rows.map((n) => ({
    ...n,
    intervention_ref: n.intervention_id ? refById.get(n.intervention_id) ?? null : null,
  }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });

  const { id } = await params;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('notes_appel')
    .select('id, client_id, intervention_id, contenu, created_by, created_at')
    .eq('client_id', id)
    .order('created_at', { ascending: false })
    .limit(MAX_NOTES);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const notes = await withRefs((data ?? []) as NoteRow[]);
  return NextResponse.json({ ok: true, notes });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as
    | { contenu?: unknown; intervention_id?: unknown }
    | null;

  const contenu = typeof body?.contenu === 'string' ? body.contenu.trim() : '';
  if (!contenu) {
    return NextResponse.json({ ok: false, error: 'Contenu requis.' }, { status: 400 });
  }
  if (contenu.length > MAX_CONTENU) {
    return NextResponse.json(
      { ok: false, error: `Contenu trop long (max ${MAX_CONTENU} caractères).` },
      { status: 400 },
    );
  }
  const interventionId =
    typeof body?.intervention_id === 'string' && body.intervention_id.trim()
      ? body.intervention_id.trim()
      : null;

  const admin = createAdminClient();

  // Le client doit exister (et fournit acp_id pour la règle de lien).
  const { data: clientRow, error: clientErr } = await admin
    .from('clients')
    .select('id, acp_id')
    .eq('id', id)
    .maybeSingle();
  if (clientErr) {
    return NextResponse.json({ ok: false, error: clientErr.message }, { status: 500 });
  }
  if (!clientRow) {
    return NextResponse.json({ ok: false, error: 'Client introuvable.' }, { status: 404 });
  }

  // Dossier lié : doit appartenir au client — mêmes règles de lien que
  // getClient360 (acp_id du client OU client_id).
  if (interventionId) {
    let ivQuery = admin
      .from('interventions')
      .select('id')
      .eq('id', interventionId)
      .is('deleted_at', null);
    ivQuery = clientRow.acp_id
      ? ivQuery.or(`acp_id.eq.${clientRow.acp_id},client_id.eq.${clientRow.id}`)
      : ivQuery.eq('client_id', clientRow.id);
    const { data: ivRow, error: ivErr } = await ivQuery.maybeSingle();
    if (ivErr) {
      return NextResponse.json({ ok: false, error: ivErr.message }, { status: 500 });
    }
    if (!ivRow) {
      return NextResponse.json(
        { ok: false, error: 'Ce dossier n\'appartient pas à ce client.' },
        { status: 400 },
      );
    }
  }

  const createdBy = user.email ?? null;
  const { data: inserted, error: insertErr } = await admin
    .from('notes_appel')
    .insert({
      client_id: id,
      intervention_id: interventionId,
      contenu,
      created_by: createdBy,
    })
    .select('id, client_id, intervention_id, contenu, created_by, created_at')
    .single();
  if (insertErr) {
    return NextResponse.json({ ok: false, error: insertErr.message }, { status: 500 });
  }

  // Événement timeline best-effort (même pattern que les autres routes
  // admin : un échec ne fait pas échouer la note).
  if (interventionId) {
    try {
      await admin.from('intervention_timeline').insert({
        intervention_id: interventionId,
        type: 'note_appel',
        message:
          contenu.length > TIMELINE_MSG_MAX
            ? `${contenu.slice(0, TIMELINE_MSG_MAX)}…`
            : contenu,
        payload: { note_id: (inserted as { id: string }).id },
        created_by: createdBy,
      });
    } catch (e) {
      console.warn('[clients/notes] timeline note_appel:', e);
    }
  }

  const [note] = await withRefs([inserted as NoteRow]);
  return NextResponse.json({ ok: true, note });
}
