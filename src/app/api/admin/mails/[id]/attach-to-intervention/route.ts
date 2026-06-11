import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from '@/lib/auth/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { downloadGmailAttachment } from '@/lib/gmail';
import { analyseAttachments } from '@/lib/agents/analyse-pj';
import type { AttachmentInput } from '@/lib/agents/analyse-pj';

// « Joindre au dossier » (Mails V2 P2 U3) : pousse les PJ d'un mail vers
// un dossier DÉJÀ créé, hors confirm-and-create. Réutilise Agent 2
// (filtre + anti-doublon U2 + renommage + upload Drive best-effort).
//
// La liste des PJ vient du CLIENT (detail.attachments déjà chargé) :
// les attachment_id Gmail sont instables entre deux lectures d'un même
// mail — on ne re-fetch jamais pour les retrouver.

export const dynamic = 'force-dynamic';
// Pipeline long : download Gmail + 1 appel LLM par PJ (~5s) + upload
// Drive — même budget que confirm-and-create.
export const maxDuration = 60;

const MAX_ATTACHMENTS_PER_CALL = 20;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // aligné sur le filtre Agent 2

interface AttachBody {
  interventionId?: unknown;
  threadId?: unknown;
  attachments?: unknown;
}

interface AttachItem {
  attachment_id: string;
  filename: string;
  mime_type: string;
  size: number;
}

function parseItems(raw: unknown): AttachItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ATTACHMENTS_PER_CALL) return null;
  const out: AttachItem[] = [];
  for (const it of raw) {
    if (typeof it !== 'object' || it === null) return null;
    const o = it as Record<string, unknown>;
    if (typeof o.attachment_id !== 'string' || !o.attachment_id) return null;
    if (typeof o.filename !== 'string' || typeof o.mime_type !== 'string') return null;
    const size = typeof o.size === 'number' && Number.isFinite(o.size) ? o.size : 0;
    if (size > MAX_ATTACHMENT_BYTES) continue; // le filtre agent l'écarterait de toute façon
    out.push({
      attachment_id: o.attachment_id,
      filename: o.filename.slice(0, 200) || 'piece-jointe',
      mime_type: o.mime_type.slice(0, 100),
      size,
    });
  }
  return out.length > 0 ? out : null;
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

  const { id: mailId } = await params;

  let body: AttachBody;
  try {
    body = (await request.json()) as AttachBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }

  const interventionId = typeof body.interventionId === 'string' ? body.interventionId.trim() : '';
  const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : '';
  const items = parseItems(body.attachments);
  if (!interventionId || !/^[0-9a-f-]{36}$/i.test(interventionId)) {
    return NextResponse.json({ ok: false, error: 'interventionId invalide.' }, { status: 400 });
  }
  if (!items) {
    return NextResponse.json({ ok: false, error: 'Aucune pièce jointe exploitable.' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: iv, error: ivErr } = await admin
    .from('interventions')
    .select('id, ref')
    .eq('id', interventionId)
    .maybeSingle();
  if (ivErr || !iv) {
    return NextResponse.json({ ok: false, error: 'Dossier introuvable.' }, { status: 404 });
  }
  const intervention = iv as { id: string; ref: string | null };

  // Téléchargement Gmail → AttachmentInput[] (best-effort par PJ).
  const errors: string[] = [];
  const agentAttachments: AttachmentInput[] = [];
  for (const it of items) {
    try {
      const data64 = await downloadGmailAttachment(mailId, it.attachment_id);
      if (!data64) {
        errors.push(`download ${it.filename}: échoué`);
        continue;
      }
      agentAttachments.push({
        filename: it.filename,
        mime_type: it.mime_type,
        size_bytes: it.size,
        content_base64: data64,
        source_mail_id: mailId,
      });
    } catch (e) {
      errors.push(`download ${it.filename}: ${e instanceof Error ? e.message : 'inconnu'}`);
    }
  }
  if (agentAttachments.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'Aucune pièce jointe téléchargeable.', errors },
      { status: 502 },
    );
  }

  const result = await analyseAttachments({
    attachments: agentAttachments,
    context: {
      intervention_id: intervention.id,
      email_id: null, // table `emails` pas encore créée
      ref_foxo: intervention.ref,
    },
  });

  const newDriveIds = result.attachments_processed
    .map((p) => p.drive_file_id)
    .filter((x): x is string => Boolean(x));
  for (const e of result.errors) errors.push(`agent2 ${e.original_filename}: ${e.error_message}`);

  // MERGE pj_drive_ids dans mails_analyses (⚠️ contrairement à
  // confirm-and-create qui écrit en remplacement) — best-effort : si le
  // mail n'a jamais été analysé, il n'y a pas de row, on n'en crée pas.
  if (threadId && newDriveIds.length > 0) {
    const { data: row } = await admin
      .from('mails_analyses')
      .select('pj_drive_ids')
      .eq('thread_id', threadId)
      .maybeSingle();
    if (row) {
      const existing = Array.isArray((row as { pj_drive_ids: string[] | null }).pj_drive_ids)
        ? (row as { pj_drive_ids: string[] }).pj_drive_ids
        : [];
      const merged = Array.from(new Set([...existing, ...newDriveIds]));
      await admin
        .from('mails_analyses')
        .update({ pj_drive_ids: merged, updated_at: new Date().toISOString() })
        .eq('thread_id', threadId);
    }
  }

  return NextResponse.json({
    ok: true,
    ref: intervention.ref,
    processed: result.attachments_processed.length,
    uploaded: newDriveIds.length,
    skipped: result.skipped,
    errors,
  });
}
