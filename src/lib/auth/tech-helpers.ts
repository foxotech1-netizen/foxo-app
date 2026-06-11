import { NextResponse } from 'next/server';
import type { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { canAccessTechSpace } from '@/lib/auth/server';

// ─────────────────────────────────────────────────────────────────────────
// Garde d'auth + ownership partagée des routes /api/tech/*.
//
// Avant ce module, le bloc « auth.getUser() → canAccessTechSpace → lookup
// utilisateurs par email lowercase → ownership intervention » était
// copié-collé dans 9 routes (constat B1 de l'audit qualité 2026-06-11),
// avec des divergences mineures de message d'erreur.
//
// Extraction ISO-COMPORTEMENT : les codes HTTP de chaque route sont
// conservés. Les MESSAGES sont unifiés (aucun appelant front ne dépend du
// texte — les composants tech vérifient uniquement res.ok / json.ok).
// ─────────────────────────────────────────────────────────────────────────

// Client SSR (anon, cookies) tel que retourné par createClient(). On le
// reçoit en paramètre pour réutiliser l'unique instance créée par la route
// (parité avec l'ancien code : un seul createClient() par requête).
type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** Échec discriminé : à propager via techError() ou directement en JSON. */
export type TechAuthFailure = { ok: false; status: 401 | 403 | 404; message: string };

export type GetCurrentTechResult =
  | { ok: true; tech: { id: string } }
  | TechAuthFailure;

/**
 * getCurrentTech — auth + résolution du technicien courant.
 *
 * Reproduit EXACTEMENT la logique historique des 9 routes /api/tech/* :
 *   1. auth.getUser() (client SSR)
 *   2. canAccessTechSpace(user.id) — rôle DB technicien OU admin (parité
 *      avec les gardes /api/tech historiques)
 *   3. lookup utilisateurs par email **lowercase** (client SSR, pas admin)
 *      pour récupérer l'id applicatif du tech
 *
 * Statuts conservés : 403 'Accès refusé.' (étapes 1-2), 403 'Tech inconnu.'
 * (étape 3). Deux routes divergeaient sur l'étape 3 — message ('Tech non
 * trouvé.' upload-photo) et statut (404 'Compte tech inconnu.' notes) ; ces
 * variantes sont harmonisées sur le canonique 403 'Tech inconnu.' (branche
 * défensive inatteignable une fois canAccessTechSpace passé, et aucun
 * appelant ne distingue 403/404 ni ne lit le texte).
 */
export async function getCurrentTech(client: ServerClient): Promise<GetCurrentTechResult> {
  const { data: { user } } = await client.auth.getUser();
  // Accès tech via le rôle DB (utilisateurs.role), pas une whitelist d'emails.
  // canAccessTechSpace autorise technicien ET admin (parité avec l'historique).
  if (!user || !(await canAccessTechSpace(user.id))) {
    return { ok: false, status: 403, message: 'Accès refusé.' };
  }

  const { data: techRow } = await client
    .from('utilisateurs')
    .select('id')
    .eq('email', (user.email ?? '').toLowerCase())
    .maybeSingle();
  if (!techRow) {
    return { ok: false, status: 403, message: 'Tech inconnu.' };
  }

  return { ok: true, tech: { id: techRow.id as string } };
}

export type VerifyInterventionResult =
  | { ok: true; intervention: Record<string, unknown> }
  | TechAuthFailure;

/**
 * verifyTechOwnsIntervention — le tech est-il assigné à cette intervention ?
 *
 * Lit interventions via le client SSR (parité avec l'historique).
 *
 * @param opts.select  Colonnes à charger (défaut 'id, technicien_id'). Permet
 *                     aux routes qui exploitent la row (rapport-docx : '*',
 *                     upload-photo : join acps) de garder une seule requête.
 * @param opts.splitNotFound  true → intervention absente = 404 'Intervention
 *                     introuvable.' (rapport-docx, notes) ; false (défaut) →
 *                     absence et non-assignation fusionnées en 403
 *                     'Intervention non assignée.' (comportement « merged »
 *                     historique des autres routes).
 */
export async function verifyTechOwnsIntervention(
  client: ServerClient,
  techId: string,
  interventionId: string,
  opts?: { select?: string; splitNotFound?: boolean },
): Promise<VerifyInterventionResult> {
  const { data: iv } = await client
    .from('interventions')
    .select(opts?.select ?? 'id, technicien_id')
    .eq('id', interventionId)
    .maybeSingle();

  if (!iv) {
    if (opts?.splitNotFound) {
      return { ok: false, status: 404, message: 'Intervention introuvable.' };
    }
    return { ok: false, status: 403, message: 'Intervention non assignée.' };
  }
  if ((iv as unknown as { technicien_id?: unknown }).technicien_id !== techId) {
    return { ok: false, status: 403, message: 'Intervention non assignée.' };
  }
  return { ok: true, intervention: iv as unknown as Record<string, unknown> };
}

export type VerifyOwnershipResult =
  | { ok: true; interventionId: string }
  | TechAuthFailure;

/**
 * verifyTechOwnsObservation — l'observation existe et appartient à une
 * intervention assignée au tech.
 *
 * Reproduit observations/[id] : lookup observation via le client **admin**
 * (RLS observations_terrain non définie), puis ownership intervention via le
 * client SSR. Statuts conservés : 404 'Observation introuvable.', 403
 * 'Observation non liée à une intervention assignée.'.
 */
export async function verifyTechOwnsObservation(
  client: ServerClient,
  techId: string,
  obsId: string,
): Promise<VerifyOwnershipResult> {
  const admin = createAdminClient();
  const { data: obsRow } = await admin
    .from('observations_terrain')
    .select('intervention_id')
    .eq('id', obsId)
    .maybeSingle();
  if (!obsRow) {
    return { ok: false, status: 404, message: 'Observation introuvable.' };
  }

  const interventionId = obsRow.intervention_id as string;
  const { data: iv } = await client
    .from('interventions')
    .select('technicien_id')
    .eq('id', interventionId)
    .maybeSingle();
  if (!iv || iv.technicien_id !== techId) {
    return {
      ok: false,
      status: 403,
      message: 'Observation non liée à une intervention assignée.',
    };
  }
  return { ok: true, interventionId };
}

/**
 * verifyTechOwnsPhoto — la photo existe et appartient à une intervention
 * assignée au tech.
 *
 * Reproduit photos/[id] : lookup photo ET intervention via le client SSR.
 * Statuts conservés : 404 'Photo introuvable.', 403 'Photo non liée à une
 * intervention assignée.'.
 */
export async function verifyTechOwnsPhoto(
  client: ServerClient,
  techId: string,
  photoId: string,
): Promise<VerifyOwnershipResult> {
  const { data: photoRow } = await client
    .from('photos_interventions')
    .select('intervention_id')
    .eq('id', photoId)
    .maybeSingle();
  if (!photoRow) {
    return { ok: false, status: 404, message: 'Photo introuvable.' };
  }

  const interventionId = photoRow.intervention_id as string;
  const { data: iv } = await client
    .from('interventions')
    .select('technicien_id')
    .eq('id', interventionId)
    .maybeSingle();
  if (!iv || iv.technicien_id !== techId) {
    return {
      ok: false,
      status: 403,
      message: 'Photo non liée à une intervention assignée.',
    };
  }
  return { ok: true, interventionId };
}

/** Convertit un échec discriminé en réponse JSON { ok: false, error }. */
export function techError(failure: TechAuthFailure): NextResponse {
  return NextResponse.json({ ok: false, error: failure.message }, { status: failure.status });
}
