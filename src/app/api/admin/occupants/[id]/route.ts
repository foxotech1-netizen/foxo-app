import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from "@/lib/auth/server";

export const dynamic = 'force-dynamic';

interface OccupantInput {
  appartement?: unknown;
  etage?: unknown;
  prenom?: unknown;
  nom?: unknown;
  email?: unknown;
  telephone?: unknown;
  instructions?: unknown;
  contact_preference?: unknown;
  type_occupant?: unknown;
}

const ALLOWED_PREF = new Set(['email', 'sms', 'whatsapp', 'both']);
// Doit rester aligné avec le CHECK SQL
// (cf. db/migrations/2026-05-29_occupant_types_extended.sql).
const ALLOWED_TYPE_OCCUPANT = new Set([
  'occupant', 'proprietaire', 'locataire', 'concierge',
  'voisin', 'gestionnaire', 'parties_communes', 'autre',
]);

function sanitize(b: OccupantInput): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const fields: (keyof OccupantInput)[] = ['appartement', 'etage', 'prenom', 'nom', 'email', 'telephone', 'instructions'];
  for (const k of fields) {
    if (typeof b[k] === 'string') {
      const v = (b[k] as string).trim();
      out[k] = v || null;
    }
  }
  if (typeof b.contact_preference === 'string' && ALLOWED_PREF.has(b.contact_preference)) {
    out.contact_preference = b.contact_preference;
  }
  if (typeof b.type_occupant === 'string' && ALLOWED_TYPE_OCCUPANT.has(b.type_occupant)) {
    out.type_occupant = b.type_occupant;
  }
  return out;
}

// SELECT en cascade — chaque niveau retire des colonnes ajoutées par
// une migration récente. Permet au drawer de rester fonctionnel même
// si une migration n'est pas encore appliquée en prod (les colonnes
// absentes sont rendues `null` côté client).
//
// L1 : SELECT complet (toutes migrations appliquées)
// L2 : sans token_sent_at + confirmation_token (migration 2026-05-11)
// L3 : sans contact_preference (migrations plus anciennes)
// L4 : core minimal — id + nom + email + telephone + appartement + conf
const SELECT_LEVELS: { cols: string; padding?: Record<string, null> }[] = [
  { cols: 'id, appartement, etage, prenom, nom, email, telephone, instructions, conf, contact_preference, token_sent_at, confirmation_token, type_occupant, proposed_creneau_debut, proposed_creneau_fin, response_note' },
  {
    cols: 'id, appartement, etage, prenom, nom, email, telephone, instructions, conf, contact_preference, token_sent_at, confirmation_token, type_occupant',
    padding: { proposed_creneau_debut: null, proposed_creneau_fin: null, response_note: null },
  },
  {
    cols: 'id, appartement, etage, prenom, nom, email, telephone, instructions, conf, contact_preference, token_sent_at, confirmation_token',
    padding: { type_occupant: null, proposed_creneau_debut: null, proposed_creneau_fin: null, response_note: null },
  },
  {
    cols: 'id, appartement, etage, prenom, nom, email, telephone, instructions, conf, contact_preference',
    padding: { type_occupant: null, token_sent_at: null, confirmation_token: null, proposed_creneau_debut: null, proposed_creneau_fin: null, response_note: null },
  },
  {
    cols: 'id, appartement, etage, prenom, nom, email, telephone, instructions, conf',
    padding: { type_occupant: null, token_sent_at: null, confirmation_token: null, contact_preference: null, proposed_creneau_debut: null, proposed_creneau_fin: null, response_note: null },
  },
  {
    cols: 'id, appartement, nom, email, telephone, conf',
    padding: { type_occupant: null, token_sent_at: null, confirmation_token: null, contact_preference: null, etage: null, prenom: null, instructions: null, proposed_creneau_debut: null, proposed_creneau_fin: null, response_note: null },
  },
];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { id } = await params;

  // Courtiers/experts mandatés sur le dossier (table dossiers_sinistres) —
  // lecture rattachée à ce même endpoint déjà appelé à l'ouverture du drawer,
  // pour éviter un aller-retour supplémentaire. Best-effort : un échec ici ne
  // doit pas casser le chargement des occupants (courtiers = []). L'admin voit
  // tous les dossiers (policy admin_all_dossiers / RLS cookie-bound).
  let courtiers: Array<{ id: string; nom: string; type: string }> = [];
  try {
    const { data: ds } = await supabase
      .from('dossiers_sinistres')
      .select('courtier_id')
      .eq('intervention_id', id);
    const courtierIds = Array.from(
      new Set((ds ?? []).map((r) => (r as { courtier_id: string | null }).courtier_id).filter(Boolean) as string[]),
    );
    if (courtierIds.length > 0) {
      const { data: orgs } = await supabase
        .from('organisations')
        .select('id, nom, type')
        .in('id', courtierIds);
      courtiers = (orgs ?? []) as Array<{ id: string; nom: string; type: string }>;
    }
  } catch { /* noop — courtiers best-effort */ }

  // Note : `intervention_id` (pas `id`) — l'id passé en paramètre est
  // l'id de l'intervention parente, pas celui d'un occupant.
  const errors: { level: number; cols: string; code: string | null; message: string }[] = [];

  for (let i = 0; i < SELECT_LEVELS.length; i++) {
    const lvl = SELECT_LEVELS[i];
    const { data, error } = await supabase
      .from('occupants')
      .select(lvl.cols)
      .eq('intervention_id', id)
      .order('appartement', { ascending: true });

    if (!error) {
      const rows = (data ?? []) as unknown as Record<string, unknown>[];
      const occupants = lvl.padding
        ? rows.map((o) => ({ ...lvl.padding, ...o }))
        : rows;
      const response: Record<string, unknown> = { ok: true, occupants, courtiers };
      if (i > 0) {
        response._warning = `fallback_level_${i}`;
        response._missing_columns = Object.keys(lvl.padding ?? {});
        console.warn(`[occupants GET] succeeded at fallback level ${i}`, {
          intervention_id: id,
          missing: Object.keys(lvl.padding ?? {}),
          previous_errors: errors,
        });
      }
      return NextResponse.json(response);
    }

    const code = (error as { code?: string }).code ?? null;
    const isColMissing = code === '42703' || /column .* does not exist/i.test(error.message);
    errors.push({ level: i, cols: lvl.cols, code, message: error.message });
    console.error(`[occupants GET] level ${i} failed`, {
      intervention_id: id,
      code,
      message: error.message,
      details: (error as { details?: string }).details ?? null,
      hint: (error as { hint?: string }).hint ?? null,
    });

    // Si l'erreur n'est pas "column missing", inutile de retenter — c'est
    // probablement un problème de RLS, table absente, etc.
    if (!isColMissing) {
      return NextResponse.json({
        ok: false,
        error: error.message,
        code,
        details: (error as { details?: string }).details ?? null,
        hint: (error as { hint?: string }).hint ?? null,
        intervention_id: id,
      }, { status: 500 });
    }
  }

  // Tous les niveaux ont échoué avec column-missing — table corrompue
  // ou colonne core absente. On renvoie tous les essais pour debug.
  return NextResponse.json({
    ok: false,
    error: 'Tous les SELECT ont échoué — table occupants probablement mal configurée.',
    intervention_id: id,
    attempts: errors,
  }, { status: 500 });
}

// POST — créer un occupant pour cette intervention
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { id } = await params;

  let body: OccupantInput;
  try {
    body = (await request.json()) as OccupantInput;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }
  const fields = sanitize(body);
  const { data, error } = await supabase
    .from('occupants')
    .insert({ ...fields, intervention_id: id, conf: 'en_attente' })
    .select('id')
    .single();
  if (error) {
    console.error('[occupants POST] supabase error', {
      intervention_id: id,
      code: (error as { code?: string }).code ?? null,
      message: error.message,
      details: (error as { details?: string }).details ?? null,
      hint: (error as { hint?: string }).hint ?? null,
    });
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: data?.id });
}
