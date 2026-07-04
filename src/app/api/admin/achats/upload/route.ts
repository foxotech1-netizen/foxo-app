// POST /api/admin/achats/upload — capture d'une facture fournisseur.
//
// Simple adaptateur HTTP du pipeline partagé processerPieceCapturee
// (src/lib/facturation/capture.ts) : garde admin, lecture du form-data,
// validations de surface, puis délégation. Comportements d'échec du
// pipeline : Drive bloquant, extraction IA best-effort.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from '@/lib/auth/server';
import {
  processerPieceCapturee,
  CAPTURE_ALLOWED_MIME,
  CAPTURE_MAX_IMAGE_BYTES,
  CAPTURE_MAX_PDF_BYTES,
} from '@/lib/facturation/capture';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

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
  const file = formData.get('fichier');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ ok: false, error: 'Fichier vide ou absent (champ « fichier »).' }, { status: 400 });
  }
  if (!CAPTURE_ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { ok: false, error: `Type non supporté (${file.type}). Attendu : PDF, jpg, png, webp.` },
      { status: 400 },
    );
  }
  const maxBytes = file.type === 'application/pdf' ? CAPTURE_MAX_PDF_BYTES : CAPTURE_MAX_IMAGE_BYTES;
  if (file.size > maxBytes) {
    return NextResponse.json(
      { ok: false, error: `Fichier trop lourd (${Math.round(file.size / 1024 / 1024)} Mo, max ${Math.round(maxBytes / 1024 / 1024)} Mo).` },
      { status: 400 },
    );
  }

  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64');
  const result = await processerPieceCapturee({
    base64,
    mimeType: file.type,
    nomFichier: file.name || 'facture-achat',
    canal: 'upload',
    creePar: user.email ?? 'admin',
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }
  return NextResponse.json({
    ok: true,
    facture_achat_id: result.facture_achat_id,
    doublon: result.doublon,
    confiance_min: result.confiance_min,
    extraction_error: result.extraction_error,
  });
}
