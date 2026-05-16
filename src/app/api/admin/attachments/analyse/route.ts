/**
 * POST /api/admin/attachments/analyse
 *
 * Déclenchement manuel de l Agent 2 — Analyse PJ par l admin.
 *
 * Body attendu :
 * {
 *   "context": {
 *     "intervention_id"?: uuid,
 *     "email_id"?: uuid,
 *     "ref_foxo"?: string,
 *     "expected_data"?: string[],
 *     "language_hint"?: "fr" | "nl" | "en"
 *   },
 *   "attachments": [
 *     { "filename": string, "mime_type": string, "size_bytes": number, "content_base64": string }
 *   ]
 * }
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';
import { analyseAttachments } from '@/lib/agents/analyse-pj';
import type { AnalyseInput } from '@/lib/agents/analyse-pj';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) {
    return NextResponse.json({ ok: false, error: 'Non authentifié.' }, { status: 401 });
  }
  const role = await roleForEmail(user.email);
  if (role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès admin requis.' }, { status: 403 });
  }

  let body: AnalyseInput;
  try {
    body = (await req.json()) as AnalyseInput;
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON invalide.' }, { status: 400 });
  }

  if (!body || !Array.isArray(body.attachments) || body.attachments.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'attachments[] requis et non vide.' },
      { status: 400 },
    );
  }
  if (body.attachments.length > 20) {
    return NextResponse.json(
      { ok: false, error: 'Maximum 20 pièces jointes par appel.' },
      { status: 400 },
    );
  }
  for (const a of body.attachments) {
    if (
      typeof a.filename !== 'string' ||
      typeof a.mime_type !== 'string' ||
      typeof a.size_bytes !== 'number' ||
      typeof a.content_base64 !== 'string'
    ) {
      return NextResponse.json(
        { ok: false, error: 'Champ pièce jointe invalide.' },
        { status: 400 },
      );
    }
  }

  try {
    const result = await analyseAttachments({
      attachments: body.attachments,
      context: body.context ?? {},
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
