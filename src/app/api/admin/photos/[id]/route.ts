import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from '@/lib/auth/server';
import { getValidAccessToken } from '@/lib/google-auth';
import { uploadPhoto } from '@/lib/google-drive';

export const dynamic = 'force-dynamic';

// Endpoint admin pour l'editeur d'annotation des photos du rapport.
//   GET  : sert l'image ORIGINALE (binaire Drive, normalisee JPEG) en MEME
//          ORIGINE, pour la charger dans un <canvas> sans "tainted canvas"
//          (les URL Drive publiques ne renvoient pas d'en-tetes CORS
//          exploitables a l'export du canvas). On sert TOUJOURS l'originale
//          (drive_file_id), jamais l'aplatie : le re-editeur repart d'une
//          image propre et restaure les annotations vectorielles depuis
//          annotations_json.
//   POST : recoit l'image annotee APLATIE (flatten du canvas) + le JSON des
//          annotations (re-editable), uploade sur Drive (uploadPhoto) puis
//          ecrit annotated_drive_file_id / annotated_drive_url / annotations_json.
//   DELETE : retire l'annotation (remet les 3 colonnes a NULL -> le rendu
//          retombe sur l'originale). Le fichier Drive annote eventuel est
//          laisse en place (orphelin benin).

const MAX_BYTES = 15 * 1024 * 1024; // 15 Mo
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

async function assertAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return !!user && (await isAdminUser());
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await assertAdmin())) {
    return NextResponse.json({ ok: false, error: 'Acces refuse.' }, { status: 403 });
  }
  const { id } = await params;

  const admin = createAdminClient();
  const { data: photo } = await admin
    .from('photos_interventions')
    .select('drive_file_id')
    .eq('id', id)
    .maybeSingle();
  const driveFileId = (photo?.drive_file_id as string | null) ?? null;
  if (!driveFileId) {
    return NextResponse.json({ ok: false, error: 'Photo introuvable.' }, { status: 404 });
  }

  const auth = await getValidAccessToken();
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Google non connecte.' }, { status: 502 });
  }

  let raw: Buffer;
  try {
    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`,
      { headers: { Authorization: `Bearer ${auth.access_token}` } },
    );
    if (!r.ok) {
      return NextResponse.json({ ok: false, error: `Drive ${r.status}` }, { status: 502 });
    }
    raw = Buffer.from(await r.arrayBuffer());
  } catch {
    return NextResponse.json({ ok: false, error: 'Telechargement Drive echoue.' }, { status: 502 });
  }

  let jpeg: Buffer;
  try {
    jpeg = await sharp(raw).rotate().jpeg({ quality: 90 }).toBuffer();
  } catch {
    return NextResponse.json({ ok: false, error: 'Decodage image echoue.' }, { status: 502 });
  }

  return new NextResponse(new Uint8Array(jpeg), {
    status: 200,
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await assertAdmin())) {
    return NextResponse.json({ ok: false, error: 'Acces refuse.' }, { status: 403 });
  }
  const { id } = await params;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'Corps invalide (formdata attendu).' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ ok: false, error: 'Fichier vide.' }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { ok: false, error: `Type non supporte (${file.type || 'inconnu'}). Attendu : jpg, png, webp.` },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: `Image trop lourde (${Math.round(file.size / (1024 * 1024))} Mo, max 15 Mo).` },
      { status: 400 },
    );
  }

  // Annotations vectorielles (re-editable). Optionnel ; JSON invalide -> null.
  let annotations: unknown = null;
  const annotationsRaw = formData.get('annotations');
  if (typeof annotationsRaw === 'string' && annotationsRaw.trim() !== '') {
    try {
      annotations = JSON.parse(annotationsRaw);
    } catch {
      annotations = null;
    }
  }

  const admin = createAdminClient();

  const { data: photo } = await admin
    .from('photos_interventions')
    .select('id, intervention_id')
    .eq('id', id)
    .maybeSingle();
  const interventionId = (photo?.intervention_id as string | null) ?? null;
  if (!interventionId) {
    return NextResponse.json({ ok: false, error: 'Photo introuvable.' }, { status: 404 });
  }

  const { data: ivRow } = await admin
    .from('interventions')
    .select('id, ref, creneau_debut, adresse, acp:acps(adresse, code_postal, ville)')
    .eq('id', interventionId)
    .maybeSingle();
  if (!ivRow) {
    return NextResponse.json({ ok: false, error: 'Intervention introuvable.' }, { status: 404 });
  }
  type IvJoined = {
    ref: string | null;
    creneau_debut: string | null;
    adresse: string | null;
    acp: { adresse: string | null; code_postal: string | null; ville: string | null } | null;
  };
  const iv = ivRow as unknown as IvJoined;
  const adresse = iv.acp
    ? [iv.acp.adresse, iv.acp.code_postal, iv.acp.ville].filter(Boolean).join(', ')
    : (iv.adresse ?? '');
  const year = iv.creneau_debut ? new Date(iv.creneau_debut).getFullYear() : new Date().getFullYear();

  const buf = Buffer.from(await file.arrayBuffer());
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const filename = `annotated_${Date.now()}.${ext}`;

  const up = await uploadPhoto({
    ref: iv.ref ?? '',
    adresse,
    year,
    filename,
    bytes: new Uint8Array(buf),
    mimeType: file.type || 'image/jpeg',
  });
  if (!up.ok) {
    return NextResponse.json({ ok: false, error: up.error }, { status: 502 });
  }

  const annotatedUrl = `https://drive.google.com/thumbnail?id=${up.file_id}&sz=w400`;

  const { error: updErr } = await admin
    .from('photos_interventions')
    .update({
      annotated_drive_file_id: up.file_id,
      annotated_drive_url: annotatedUrl,
      annotations_json: annotations,
    })
    .eq('id', id);
  if (updErr) {
    return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    id,
    annotated_drive_file_id: up.file_id,
    annotated_url: annotatedUrl,
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await assertAdmin())) {
    return NextResponse.json({ ok: false, error: 'Acces refuse.' }, { status: 403 });
  }
  const { id } = await params;

  const admin = createAdminClient();
  const { error } = await admin
    .from('photos_interventions')
    .update({
      annotated_drive_file_id: null,
      annotated_drive_url: null,
      annotations_json: null,
    })
    .eq('id', id);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id });
}
