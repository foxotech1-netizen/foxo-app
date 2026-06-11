import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from '@/lib/auth/server';
import { downloadGmailAttachment } from '@/lib/gmail';
import { sanitizeFilename, sanitizeMime, buildSafeFileHeaders } from '@/lib/http/safe-file-response';

// Téléchargement / aperçu d'une pièce jointe Gmail (Mails V2 P2).
// `name` et `mime` viennent du client (detail.attachments les connaît
// déjà) : évite un re-fetch Gmail format=full dont les attachment_id
// peuvent différer entre deux lectures (instabilité connue de l'API).
// Sanitisation + en-têtes sûrs (SVG jamais inline, nosniff, CSP sandbox,
// RFC 5987) : mutualisés dans lib/http/safe-file-response.ts (U4) —
// comportement identique à la version locale d'origine (PR #91).

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Plafond de réponse des fonctions Vercel ~4,5 MB : au-delà on renvoie
// un 413 propre et l'admin passe par « ↗ Voir dans Gmail ».
const MAX_ATTACHMENT_DOWNLOAD_BYTES = 4 * 1024 * 1024;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

  const { id, attachmentId } = await params;
  const url = new URL(request.url);
  const filename = sanitizeFilename(url.searchParams.get('name') ?? '');
  const mime = sanitizeMime(url.searchParams.get('mime') ?? '');

  const data = await downloadGmailAttachment(id, attachmentId);
  if (data === null) {
    return NextResponse.json(
      { ok: false, error: 'Pièce jointe introuvable.' },
      { status: 404 },
    );
  }

  // Gmail renvoie du base64 URL-safe.
  const buf = Buffer.from(data, 'base64url');
  if (buf.byteLength > MAX_ATTACHMENT_DOWNLOAD_BYTES) {
    return NextResponse.json(
      { ok: false, error: 'Pièce jointe trop volumineuse — ouvrez-la dans Gmail.' },
      { status: 413 },
    );
  }

  return new NextResponse(new Uint8Array(buf), {
    headers: buildSafeFileHeaders({ filename, mime, byteLength: buf.byteLength }),
  });
}
