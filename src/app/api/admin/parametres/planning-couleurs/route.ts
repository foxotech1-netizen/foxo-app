import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from "@/lib/auth/server";
import type { Utilisateur } from '@/lib/types/database';

export const dynamic = 'force-dynamic';

// Couleurs par défaut — utilisées si la migration 2026-05-21 n'est pas
// appliquée OU si un paramètre est absent. Doivent rester en sync avec
// la migration (colonne valeur par défaut).
export const DEFAULT_PLANNING_COLORS = {
  libre: '#1F6B45',
  reserve: '#1B3A6B',
  bloque: '#6B7280',
  google: '#4338CA',
  foxo_importe: '#7C3AED',
} as const;

export const PLANNING_COLOR_KEYS = {
  libre: 'planning_couleur_libre',
  reserve: 'planning_couleur_reserve',
  bloque: 'planning_couleur_bloque',
  google: 'planning_couleur_google',
  foxo_importe: 'planning_couleur_foxo_importe',
} as const;

export type PlanningColorType = keyof typeof DEFAULT_PLANNING_COLORS;

export interface PlanningCouleursPayload {
  types: Record<PlanningColorType, string>;
  techniciens: { id: string; couleur: string | null }[];
}

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
function isHex(s: unknown): s is string {
  return typeof s === 'string' && HEX_RE.test(s);
}

// GET — renvoie les couleurs courantes (avec fallback aux défauts si
// un paramètre est absent).
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

  const keys = Object.values(PLANNING_COLOR_KEYS);
  const { data: paramRows } = await supabase
    .from('parametres')
    .select('cle, valeur')
    .in('cle', keys);
  const map = new Map<string, string>();
  for (const p of (paramRows ?? []) as { cle: string; valeur: string | null }[]) {
    if (p.valeur) map.set(p.cle, p.valeur);
  }
  const types: Record<PlanningColorType, string> = {
    libre: map.get(PLANNING_COLOR_KEYS.libre) ?? DEFAULT_PLANNING_COLORS.libre,
    reserve: map.get(PLANNING_COLOR_KEYS.reserve) ?? DEFAULT_PLANNING_COLORS.reserve,
    bloque: map.get(PLANNING_COLOR_KEYS.bloque) ?? DEFAULT_PLANNING_COLORS.bloque,
    google: map.get(PLANNING_COLOR_KEYS.google) ?? DEFAULT_PLANNING_COLORS.google,
    foxo_importe: map.get(PLANNING_COLOR_KEYS.foxo_importe) ?? DEFAULT_PLANNING_COLORS.foxo_importe,
  };

  // Liste des techniciens avec leur couleur
  const { data: techRows } = await supabase
    .from('utilisateurs')
    .select('id, prenom, nom, email, couleur')
    .eq('role', 'technicien')
    .order('prenom', { ascending: true });
  type TechRow = Pick<Utilisateur, 'id' | 'prenom' | 'nom' | 'email' | 'couleur'>;
  const techniciens = ((techRows ?? []) as TechRow[]).map((t) => ({
    id: t.id,
    prenom: t.prenom,
    nom: t.nom,
    email: t.email,
    couleur: t.couleur ?? null,
  }));

  return NextResponse.json({ ok: true, types, techniciens });
}

// PATCH — sauvegarde toutes les couleurs en une fois. Body :
// { types: {...}, techniciens: [{id, couleur}] }
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

  let body: { types?: unknown; techniciens?: unknown };
  try {
    body = await request.json() as { types?: unknown; techniciens?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }

  // Valide + upsert les types
  const types = (body.types ?? {}) as Partial<Record<PlanningColorType, unknown>>;
  const upserts: { cle: string; valeur: string; updated_at: string }[] = [];
  const now = new Date().toISOString();
  for (const [k, dbKey] of Object.entries(PLANNING_COLOR_KEYS) as [PlanningColorType, string][]) {
    const v = types[k];
    if (v === undefined) continue;
    if (!isHex(v)) {
      return NextResponse.json({ ok: false, error: `Couleur invalide pour ${k} : attend #RRGGBB.` }, { status: 400 });
    }
    upserts.push({ cle: dbKey, valeur: v, updated_at: now });
  }
  if (upserts.length > 0) {
    const { error: upErr } = await supabase
      .from('parametres')
      .upsert(upserts, { onConflict: 'cle' });
    if (upErr) {
      return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
    }
  }

  // Valide + update les techniciens
  const techList = Array.isArray(body.techniciens) ? body.techniciens : [];
  for (const raw of techList) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as { id?: unknown; couleur?: unknown };
    if (typeof r.id !== 'string' || !r.id) continue;
    const couleur = r.couleur === null ? null : (isHex(r.couleur) ? r.couleur : undefined);
    if (couleur === undefined) {
      return NextResponse.json({ ok: false, error: `Couleur invalide pour technicien ${r.id} : attend #RRGGBB ou null.` }, { status: 400 });
    }
    const { error: techErr } = await supabase
      .from('utilisateurs')
      .update({ couleur })
      .eq('id', r.id);
    if (techErr) {
      const code = (techErr as { code?: string }).code;
      // 42703 = colonne couleur absente → migration 2026-05-21 pas appliquée
      if (code === '42703') {
        return NextResponse.json({
          ok: false,
          error: 'Colonne utilisateurs.couleur absente. Applique la migration 2026-05-21_planning_couleurs.sql.',
        }, { status: 503 });
      }
      return NextResponse.json({ ok: false, error: techErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
