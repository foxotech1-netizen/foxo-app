import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from "@/lib/auth/server";
import { geocodeAddress } from '@/lib/geo/geocode';

export const dynamic = 'force-dynamic';

interface AcpInput {
  nom?: unknown;
  adresse?: unknown;
  code_postal?: unknown;
  ville?: unknown;
  bce?: unknown;
  email_rapports?: unknown;
  email_factures?: unknown;
  syndic_id?: unknown;
  syndic_id_ref?: unknown;
  lat?: unknown;
  lng?: unknown;
}

function strOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t || null;
}

function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    if (isFinite(n)) return n;
  }
  return null;
}

// POST /api/admin/acps
//
// Création rapide d'une ACP depuis le drawer syndic (formulaire inline).
// Insert dans la table `acps` (technique / interventions) — distincte de
// la table `clients` (facturation) où ClientForm écrit. Le brief
// initial mentionnait `clients` mais le drawer lit `acps` via
// /api/admin/syndics/[org_id]/acps : si on insérait dans clients, la
// nouvelle ACP n'apparaîtrait pas dans le drawer après refresh.
//
// Pour qu'une ACP soit aussi visible côté facturation, l'admin doit
// passer par /admin/clients/new (qui peuple `clients` avec type='acp').
// La consolidation des deux tables est hors scope de ce sprint.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

  let body: AcpInput;
  try {
    body = (await request.json()) as AcpInput;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }

  const nom = strOrNull(body.nom);
  if (!nom) {
    return NextResponse.json({ ok: false, error: 'Nom requis.' }, { status: 400 });
  }

  const payload: Record<string, string | number | null> = {
    nom,
    adresse:        strOrNull(body.adresse),
    code_postal:    strOrNull(body.code_postal),
    ville:          strOrNull(body.ville),
    bce:            strOrNull(body.bce),
    email_rapports: strOrNull(body.email_rapports)?.toLowerCase() ?? null,
    email_factures: strOrNull(body.email_factures)?.toLowerCase() ?? null,
    // syndic_id : NOT NULL en DB. On accepte syndic_id direct ou fallback
    // sur syndic_id_ref (le drawer envoie les deux à la même valeur).
    syndic_id:      strOrNull(body.syndic_id) ?? strOrNull(body.syndic_id_ref),
    syndic_id_ref:  strOrNull(body.syndic_id_ref),
    lat:            numOrNull(body.lat),
    lng:            numOrNull(body.lng),
  };

  // Si l'adresse n'a pas été choisie via l'autocomplete (coordonnées absentes),
  // géocodage côté serveur best-effort (Nominatim, Belgique) pour que l'ACP
  // apparaisse sur la carte admin. Échec → lat/lng restent null (inchangé).
  if (payload.lat == null || payload.lng == null) {
    const geoQuery = [payload.adresse, payload.code_postal, payload.ville]
      .filter((s): s is string => typeof s === 'string' && s.length > 0)
      .join(', ');
    if (geoQuery) {
      const geo = await geocodeAddress(geoQuery);
      if (geo) {
        payload.lat = geo.lat;
        payload.lng = geo.lng;
      }
    }
  }

  const { data, error } = await supabase
    .from('acps')
    .insert(payload)
    .select('id, nom')
    .maybeSingle();
  if (error) {
    console.error('[acps POST] insert error', {
      code: (error as { code?: string }).code ?? null,
      message: error.message,
      details: (error as { details?: string }).details ?? null,
      hint: (error as { hint?: string }).hint ?? null,
    });
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ ok: false, error: 'Erreur création.' }, { status: 500 });

  return NextResponse.json({ ok: true, acp: { id: data.id as string, nom: data.nom as string | null } });
}
