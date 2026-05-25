import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { roleForEmail } from '@/lib/auth/roles';
import { isAdminUser } from "@/lib/auth/server";

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const BUCKET = 'notes-frais-photos';
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
};

// POST /api/tech/notes-frais/upload
//
// Form-data : { photo: File, note_id?: string }
//
// Upload la photo vers Supabase Storage (bucket public 'notes-frais-photos'),
// retourne l'URL publique. Si note_id est fourni, patch directement
// notes_frais.photo_url côté DB pour lier la photo à la note existante.
//
// Sécurité : tech connecté (whitelist OU role DB) ou admin.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Autorise les techs whitelist (TECH_EMAILS), les admins, et tout
  // utilisateur dont la row utilisateurs porte role = 'technicien'
  // (techs créés en DB sans être hardcodés dans roles.ts).
  const role = roleForEmail(user?.email);
  const isAdmin = await isAdminUser();
  const isTech = role === 'tech' || isAdmin;
  const isTechDB = user
    ? await supabase
        .from('utilisateurs')
        .select('id')
        .eq('email', (user.email ?? '').toLowerCase())
        .eq('role', 'technicien')
        .maybeSingle()
        .then((r) => !!r.data)
    : false;
  if (!user || (!isTech && !isTechDB)) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'Form-data attendu.' }, { status: 400 });
  }

  const file = formData.get('photo');
  const noteIdRaw = formData.get('note_id');
  const noteId = typeof noteIdRaw === 'string' && noteIdRaw.length > 0 ? noteIdRaw : null;

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ ok: false, error: 'Fichier vide ou absent.' }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { ok: false, error: `Type non supporté (${file.type}). Attendu : jpg, png, webp.` },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: `Photo trop lourde (${Math.round(file.size / 1024)} Ko, max 5 Mo).` },
      { status: 400 },
    );
  }

  const ext = EXT_BY_MIME[file.type] ?? 'bin';
  const email = (user.email ?? 'anonymous').toLowerCase();
  const random = Math.random().toString(36).slice(2, 10);
  const path = `${email}/${Date.now()}_${random}.${ext}`;

  // Service-role pour bypass RLS sur le bucket — l'ownership a été
  // contrôlée plus haut via l'auth utilisateur.
  const admin = createAdminClient();
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(path, bytes, {
      contentType: file.type,
      upsert: false,
    });
  if (upErr) {
    return NextResponse.json({ ok: false, error: upErr.message }, { status: 502 });
  }

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
  const url = pub.publicUrl;

  // Si note_id : lie la photo à la note existante. On vérifie en amont
  // que la note appartient au tech connecté pour éviter qu'un tech
  // patche la note d'un collègue.
  if (noteId) {
    const { data: noteRow } = await admin
      .from('notes_frais')
      .select('technicien_email')
      .eq('id', noteId)
      .maybeSingle();
    if (!noteRow) {
      return NextResponse.json({ ok: false, error: 'Note introuvable.' }, { status: 404 });
    }
    const owner = (noteRow.technicien_email as string | null ?? '').toLowerCase();
    if (owner !== email && !isAdmin) {
      return NextResponse.json({ ok: false, error: 'Note non assignée.' }, { status: 403 });
    }
    const { error: patchErr } = await admin
      .from('notes_frais')
      .update({ photo_url: url, updated_at: new Date().toISOString() })
      .eq('id', noteId);
    if (patchErr) {
      return NextResponse.json({ ok: false, error: patchErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, url, path });
}
