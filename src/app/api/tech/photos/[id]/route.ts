import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentTech, verifyTechOwnsPhoto, techError } from '@/lib/auth/tech-helpers';

export const dynamic = 'force-dynamic';

const ALLOWED_SECTIONS = new Set(['degats', 'inspection', 'conclusion', 'recommandations']);

// PATCH /api/tech/photos/[id]
//
// Body : { section?, ordre? }
//   - section : 'degats' | 'inspection' | 'conclusion' | 'recommandations' | null
//     null = retire la photo de la section (la photo reste sur Drive et
//     dans photos_interventions, mais n'est plus rattachée à une section
//     du rapport).
//   - ordre : entier — position dans la section (réordonnage).
//
// Vérifie que la photo appartient à une intervention assignée au tech.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const tech = await getCurrentTech(supabase);
  if (!tech.ok) return techError(tech);

  const { id } = await params;

  let body: { section?: unknown; ordre?: unknown; label?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }

  // Ownership : photo → intervention → tech
  const owns = await verifyTechOwnsPhoto(supabase, tech.tech.id, id);
  if (!owns.ok) return techError(owns);

  // Build patch
  const patch: Record<string, unknown> = {};
  if ('section' in body) {
    if (body.section === null) {
      patch.section = null;
      patch.ordre = 0;
    } else if (typeof body.section === 'string' && ALLOWED_SECTIONS.has(body.section)) {
      patch.section = body.section;
    } else {
      return NextResponse.json(
        { ok: false, error: 'section invalide (degats|inspection|conclusion|recommandations|null).' },
        { status: 400 },
      );
    }
  }
  if ('ordre' in body) {
    if (typeof body.ordre === 'number' && Number.isInteger(body.ordre) && body.ordre >= 0) {
      patch.ordre = body.ordre;
    } else {
      return NextResponse.json({ ok: false, error: 'ordre doit être un entier >= 0.' }, { status: 400 });
    }
  }
  if ('label' in body) {
    if (body.label === null) {
      patch.label = null;
    } else if (typeof body.label === 'string') {
      patch.label = body.label.trim().slice(0, 200) || null;
    } else {
      return NextResponse.json({ ok: false, error: 'label doit être string ou null.' }, { status: 400 });
    }
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: 'Rien à mettre à jour.' }, { status: 400 });
  }

  // Service-role : RLS UPDATE peut être restrictive selon le setup,
  // l'ownership est vérifié au-dessus.
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('photos_interventions')
    .update(patch)
    .eq('id', id)
    .select('id, drive_url, filename, section, ordre, uploaded_at, label')
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, photo: data });
}
