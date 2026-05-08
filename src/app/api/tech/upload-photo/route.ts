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
  // Autorise les techs whitelist (TECH_EMAILS), les admins, et tout
  // utilisateur dont la row utilisateurs porte role = 'technicien'
  // (techs créés en DB sans être hardcodés dans roles.ts).
  const role = roleForEmail(user?.email);
  const isTech = role === 'tech' || role === 'admin';
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
  // Section optionnelle — quand fournie, la photo est attachée à la
  // section du rapport correspondante (cf. migration 2026-05-28_photos_section).
  const sectionRaw = formData.get('section');
  const ALLOWED_SECTIONS = new Set(['degats', 'inspection', 'conclusion', 'recommandations']);
  const section = typeof sectionRaw === 'string' && ALLOWED_SECTIONS.has(sectionRaw)
    ? sectionRaw
    : null;
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
  // route — fallback robuste). Si section fournie, calcule le prochain
  // ordre = max(ordre) + 1 dans cette section.
  let insertedId: string | null = null;
  try {
    const admin = createAdminClient();

    let ordre = 0;
    if (section) {
      const { data: maxRow } = await admin
        .from('photos_interventions')
        .select('ordre')
        .eq('intervention_id', interventionId)
        .eq('section', section)
        .order('ordre', { ascending: false })
        .limit(1)
        .maybeSingle();
      ordre = ((maxRow?.ordre as number | null) ?? -1) + 1;
    }

    const { data: insertedRow } = await admin
      .from('photos_interventions')
      .insert({
        intervention_id: interventionId,
        drive_file_id: up.file_id,
        // Thumbnail publique (Drive permission anyoneWithLink posée par
        // makeFilePublic dans uploadPhoto). sz=w400 = bonne qualité tout
        // en gardant le payload léger pour l'UI mobile/desktop.
        drive_url: `https://drive.google.com/thumbnail?id=${up.file_id}&sz=w400`,
        filename,
        uploaded_by: user.id,
        section,
        ordre,
      })
      .select('id')
      .maybeSingle();
    insertedId = (insertedRow?.id as string | undefined) ?? null;
  } catch (e) {
    console.warn('[upload-photo] DB insert skipped:', e);
  }

  return NextResponse.json({
    ok: true,
    id: insertedId,
    drive_file_id: up.file_id,
    drive_url: up.web_view_link,
    filename,
    section,
  });
}
