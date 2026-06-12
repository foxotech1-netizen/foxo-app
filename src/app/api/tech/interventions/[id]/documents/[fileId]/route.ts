import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getCurrentTech, verifyTechOwnsIntervention, techError } from '@/lib/auth/tech-helpers';
import { getDriveFileMeta, resolveInterventionFolderByName } from '@/lib/google-drive';
import { getValidAccessToken } from '@/lib/google-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Aperçu / téléchargement d'un document Drive du dossier d'intervention
// (Mails V2 P2 — U4, panneau Documents du portail technicien).
//
// Verrou central : le fichier doit avoir le dossier Drive de CETTE
// intervention dans ses `parents` — la RLS ne protège pas Drive, c'est ce
// contrôle qui empêche un tech de lire un fichier arbitraire par son ID.
// Protections de sortie identiques à la route PJ Gmail (admin/mails) :
// filename sanitisé, MIME en whitelist, SVG jamais inline, nosniff,
// CSP sandbox, borne de taille, cache privé.

// Plafond de réponse des fonctions Vercel ~4,5 MB : au-delà on renvoie
// un 413 propre et le tech passe par « Ouvrir dans Drive ».
const MAX_DOCUMENT_DOWNLOAD_BYTES = 4 * 1024 * 1024;

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
  return cleaned || 'document';
}

function sanitizeMime(raw: string): string {
  const mime = raw.trim().toLowerCase();
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime)) return 'application/octet-stream';
  return MIME_PREFIX_WHITELIST.some((p) => mime.startsWith(p))
    ? mime
    : 'application/octet-stream';
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const supabase = await createClient();
  const tech = await getCurrentTech(supabase);
  if (!tech.ok) return techError(tech);

  const { id, fileId } = await params;
  // technicien_id est REQUIS dans le select : verifyTechOwnsIntervention
  // compare iv.technicien_id au tech courant (même pattern qu'upload-photo).
  const owns = await verifyTechOwnsIntervention(supabase, tech.tech.id, id, {
    select: 'id, ref, technicien_id, drive_folder_id',
    splitNotFound: true,
  });
  if (!owns.ok) return techError(owns);

  const iv = owns.intervention as { id: string; ref: string | null; drive_folder_id: string | null };

  // Même résolution que la route de listing : drive_folder_id, sinon par ref.
  let folderId = iv.drive_folder_id;
  if (!folderId && iv.ref) {
    const yr = Number(iv.ref.slice(0, 4)) || new Date().getFullYear();
    folderId = await resolveInterventionFolderByName(iv.ref, yr);
  }
  if (!folderId) {
    return NextResponse.json(
      { ok: false, error: "Cette intervention n'a pas de dossier Drive." },
      { status: 404 },
    );
  }

  const metaRes = await getDriveFileMeta(fileId);
  if (!metaRes.ok) {
    const status = metaRes.error.includes('introuvable') ? 404 : 502;
    return NextResponse.json({ ok: false, error: metaRes.error }, { status });
  }
  const meta = metaRes.meta;

  // Verrou d'appartenance : le fichier doit être un enfant direct du
  // dossier de l'intervention assignée.
  if (!meta.parents.includes(folderId)) {
    return NextResponse.json(
      { ok: false, error: "Ce fichier n'appartient pas au dossier de cette intervention." },
      { status: 403 },
    );
  }

  if (meta.size != null && meta.size > MAX_DOCUMENT_DOWNLOAD_BYTES) {
    return NextResponse.json(
      { ok: false, error: 'Fichier trop volumineux — ouvre-le dans Drive.' },
      { status: 413 },
    );
  }

  const auth = await getValidAccessToken();
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Google non connecté.' }, { status: 502 });
  }

  // Téléchargement du contenu (alt=media). Échoue notamment pour les
  // fichiers Google natifs (Docs/Sheets) — le panneau les ouvre dans Drive.
  let res: Response;
  try {
    res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${auth.access_token}` } },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `Échec réseau Drive : ${e instanceof Error ? e.message : 'inconnu'}` },
      { status: 502 },
    );
  }
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: `Téléchargement Drive impossible (HTTP ${res.status}) — ouvre le fichier dans Drive.` },
      { status: 502 },
    );
  }

  const buf = Buffer.from(await res.arrayBuffer());
  // Re-borne après téléchargement : meta.size peut être absent (null).
  if (buf.byteLength > MAX_DOCUMENT_DOWNLOAD_BYTES) {
    return NextResponse.json(
      { ok: false, error: 'Fichier trop volumineux — ouvre-le dans Drive.' },
      { status: 413 },
    );
  }

  const filename = sanitizeFilename(meta.name);
  const mime = sanitizeMime(meta.mimeType);

  // inline pour ce que le navigateur prévisualise nativement, attachment
  // sinon. filename* RFC 5987 pour les accents ; filename ASCII en repli.
  // SVG exclu de l'inline : il peut embarquer du script → XSS sur l'origine.
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
