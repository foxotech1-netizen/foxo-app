import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from '@/lib/auth/server';
import { downloadGmailAttachment } from '@/lib/gmail';

// Téléchargement / aperçu d'une pièce jointe Gmail (Mails V2 P2).
// `name` et `mime` viennent du client (detail.attachments les connaît
// déjà) : évite un re-fetch Gmail format=full dont les attachment_id
// peuvent différer entre deux lectures (instabilité connue de l'API).
// Les deux sont sanitisés ici — jamais reflétés tels quels.

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Plafond de réponse des fonctions Vercel ~4,5 MB : au-delà on renvoie
// un 413 propre et l'admin passe par « ↗ Voir dans Gmail ».
const MAX_ATTACHMENT_DOWNLOAD_BYTES = 4 * 1024 * 1024;

// Préfixes MIME autorisés tels quels ; tout le reste est servi en
// application/octet-stream (téléchargement neutre, pas d'interprétation
// navigateur d'un type exotique/forgé).
const MIME_PREFIX_WHITELIST = [
  'image/',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'text/plain',
  'text/csv',
  'application/zip',
];

function sanitizeFilename(raw: string): string {
  const cleaned = raw
    .replace(/[/\\]/g, '_')            // chemins
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, '')   // caractères de contrôle
    .replace(/["';]/g, '')             // quoting des en-têtes
    .trim()
    .slice(0, 150);
  return cleaned || 'piece-jointe';
}

function sanitizeMime(raw: string): string {
  const mime = raw.trim().toLowerCase();
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime)) return 'application/octet-stream';
  return MIME_PREFIX_WHITELIST.some((p) => mime.startsWith(p))
    ? mime
    : 'application/octet-stream';
}

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

  // inline pour ce que le navigateur prévisualise nativement, attachment
  // sinon. filename* RFC 5987 pour les accents ; filename ASCII en repli.
  // SVG exclu de l'inline : il peut embarquer du script → XSS sur l'origine admin.
  const inline = (mime.startsWith('image/') && mime !== 'image/svg+xml') || mime === 'application/pdf';
  const asciiName = filename.replace(/[^\x20-\x7E]/g, '_');
  const disposition =
    `${inline ? 'inline' : 'attachment'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`;

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': mime,
      'Content-Disposition': disposition,
      'Content-Length': String(buf.byteLength),
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      // Défense en profondeur : neutralise tout script même si un type
      // inline était un jour mal classé.
      'Content-Security-Policy': 'sandbox',
    },
  });
}
