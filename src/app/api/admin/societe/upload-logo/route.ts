import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from "@/lib/auth/server";

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Bucket Supabase Storage — à créer manuellement avant le 1er upload :
//
//   INSERT INTO storage.buckets (id, name, public, file_size_limit)
//   VALUES ('societe-assets', 'societe-assets', true, 2097152)
//   ON CONFLICT (id) DO NOTHING;
//
//   CREATE POLICY "public_read_societe_assets"
//     ON storage.objects FOR SELECT
//     TO public
//     USING (bucket_id = 'societe-assets');
//
// Bucket public + ≤ 2 Mo. Service-role uniquement pour les writes
// (admin via cette route).
const BUCKET = 'societe-assets';
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/svg+xml',
]);
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg':    'jpg',
  'image/png':     'png',
  'image/webp':    'webp',
  'image/svg+xml': 'svg',
};

// POST /api/admin/societe/upload-logo
//
// Form-data : { logo: File }
//
// Upload le logo de la société (path fixe `logo/societe_logo.{ext}`,
// upsert: true → écrase l'ancien à chaque nouveau push). Met à jour
// la clé KV `societe_logo_url` dans `parametres` avec l'URL publique.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'Form-data attendu.' }, { status: 400 });
  }

  const file = formData.get('logo');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ ok: false, error: 'Logo manquant ou vide.' }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { ok: false, error: `Type non supporté (${file.type}). Attendu : jpg, png, webp, svg.` },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: `Logo trop lourd (${Math.round(file.size / 1024)} Ko, max 2 Mo).` },
      { status: 400 },
    );
  }

  const ext = EXT_BY_MIME[file.type] ?? 'bin';
  const path = `logo/societe_logo.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const admin = createAdminClient();
  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(path, bytes, {
      contentType: file.type,
      upsert: true,
    });
  if (upErr) {
    return NextResponse.json({ ok: false, error: upErr.message }, { status: 502 });
  }

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
  // Cache-bust : ajout d'un timestamp pour forcer le navigateur à
  // recharger l'image après upsert (sinon l'ancien URL est mis en
  // cache par Supabase CDN/browser).
  const url = `${pub.publicUrl}?v=${Date.now()}`;

  const { error: paramErr } = await admin
    .from('parametres')
    .upsert(
      { cle: 'societe_logo_url', valeur: url, updated_at: new Date().toISOString() },
      { onConflict: 'cle' },
    );
  if (paramErr) {
    return NextResponse.json({ ok: false, error: paramErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, url });
}
