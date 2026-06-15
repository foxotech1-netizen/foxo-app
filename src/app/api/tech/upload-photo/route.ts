import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentTech, verifyTechOwnsIntervention, techError } from '@/lib/auth/tech-helpers';
import { uploadPhoto, resolveInterventionFolderByName } from '@/lib/google-drive';

export const dynamic = 'force-dynamic';

// Bornes upload photo terrain (constat sécurité #9) — aligné sur upload-logo.
// 15 Mo couvre largement une photo de smartphone (HEIC/JPEG haute résolution)
// sans permettre l'épuisement du quota Drive / du temps serveur. MIME en
// whitelist stricte : jpeg/png/webp + heic/heif (photos iOS).
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export async function POST(request: Request) {
  // Auth tech + résolution du tech courant (bloc partagé, cf.
  // lib/auth/tech-helpers). tech.tech.id = utilisateurs.id = auth uid.
  const supabase = await createClient();
  const tech = await getCurrentTech(supabase);
  if (!tech.ok) return techError(tech);

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
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { ok: false, error: `Type non supporté (${file.type || 'inconnu'}). Attendu : jpg, png, webp, heic.` },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: `Photo trop lourde (${Math.round(file.size / (1024 * 1024))} Mo, max 15 Mo).` },
      { status: 400 },
    );
  }
  if (!interventionId) {
    return NextResponse.json({ ok: false, error: 'intervention_id manquant.' }, { status: 400 });
  }

  // Vérifie que ce tech est assigné à l'intervention. select avec join acps
  // pour conserver une seule requête (les champs servent au chemin Drive).
  const owns = await verifyTechOwnsIntervention(supabase, tech.tech.id, interventionId, {
    select: 'id, ref, technicien_id, adresse, creneau_debut, drive_folder_id, acp:acps(adresse, code_postal, ville)',
  });
  if (!owns.ok) return techError(owns);

  type IvJoined = {
    id: string; ref: string | null;
    adresse: string | null;
    creneau_debut: string | null;
    drive_folder_id: string | null;
    acp: { adresse: string | null; code_postal: string | null; ville: string | null } | null;
  };
  const ivT = owns.intervention as unknown as IvJoined;
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

  // Backfill best-effort de drive_folder_id si l'intervention n'en a pas encore
  // (dossiers créés sans persistance du folder — ex. création admin silencieuse).
  // uploadPhoto vient d'assurer le dossier Drive → on le résout par nom et on
  // l'enregistre. Idempotent (filtre .is null), non bloquant.
  if (!ivT.drive_folder_id) {
    try {
      const folderId = await resolveInterventionFolderByName(ivT.ref ?? '', year);
      if (folderId) {
        await createAdminClient()
          .from('interventions')
          .update({ drive_folder_id: folderId, updated_at: new Date().toISOString() })
          .eq('id', interventionId)
          .is('drive_folder_id', null);
      }
    } catch (e) {
      console.warn('[upload-photo] backfill drive_folder_id skipped:', e);
    }
  }

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
        uploaded_by: tech.tech.id,
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
