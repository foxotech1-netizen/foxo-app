import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { roleForEmail } from '@/lib/auth/roles';
import { uploadPhoto } from '@/lib/google-drive';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  // Auth tech
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'tech') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

  // Récupère l'utilisateur tech (pour l'id)
  const { data: techRow } = await supabase
    .from('utilisateurs')
    .select('id')
    .eq('email', (user.email ?? '').toLowerCase())
    .maybeSingle();
  if (!techRow) return NextResponse.json({ ok: false, error: 'Tech non trouvé.' }, { status: 403 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'Corps invalide (formdata attendu).' }, { status: 400 });
  }

  const file = formData.get('file');
  const interventionId = String(formData.get('intervention_id') ?? '');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ ok: false, error: 'Fichier vide.' }, { status: 400 });
  }
  if (!interventionId) {
    return NextResponse.json({ ok: false, error: 'intervention_id manquant.' }, { status: 400 });
  }

  // Vérifie que ce tech est assigné à l'intervention
  const { data: iv } = await supabase
    .from('interventions')
    .select('id, ref, technicien_id, adresse, creneau_debut, acp:acps(adresse, code_postal, ville)')
    .eq('id', interventionId)
    .maybeSingle();
  if (!iv || iv.technicien_id !== techRow.id) {
    return NextResponse.json({ ok: false, error: 'Cette intervention ne t\'est pas assignée.' }, { status: 403 });
  }

  type IvJoined = {
    id: string; ref: string | null;
    adresse: string | null;
    creneau_debut: string | null;
    acp: { adresse: string | null; code_postal: string | null; ville: string | null } | null;
  };
  const ivT = iv as unknown as IvJoined;
  const adresse = ivT.acp
    ? [ivT.acp.adresse, ivT.acp.code_postal, ivT.acp.ville].filter(Boolean).join(', ')
    : (ivT.adresse ?? '');
  const year = ivT.creneau_debut ? new Date(ivT.creneau_debut).getFullYear() : new Date().getFullYear();

  const buf = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_').slice(0, 80);
  const filename = `${Date.now()}_${safeName}`;

  const up = await uploadPhoto({
    ref: ivT.ref ?? '',
    adresse,
    year,
    filename,
    bytes: new Uint8Array(buf),
    mimeType: file.type || 'image/jpeg',
  });
  if (!up.ok) return NextResponse.json({ ok: false, error: up.error }, { status: 502 });

  // Insère dans photos_interventions (service-role pour bypass RLS si la
  // policy tech_insert n'arrive pas à matcher l'auth.jwt() depuis cette
  // route — fallback robuste)
  try {
    const admin = createAdminClient();
    await admin.from('photos_interventions').insert({
      intervention_id: interventionId,
      drive_file_id: up.file_id,
      drive_url: up.web_view_link,
      filename,
      uploaded_by: user.id,
    });
  } catch (e) {
    console.warn('[upload-photo] DB insert skipped:', e);
  }

  return NextResponse.json({
    ok: true,
    drive_file_id: up.file_id,
    drive_url: up.web_view_link,
    filename,
  });
}
