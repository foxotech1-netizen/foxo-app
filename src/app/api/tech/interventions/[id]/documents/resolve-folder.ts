// Helpers serveur partagés par les deux routes documents (liste + proxy).
// Pas un fichier de route — seul route.ts est spécial pour l'App Router.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from '@/lib/auth/server';
import { getCurrentTech, verifyTechOwnsIntervention, type TechAuthFailure } from '@/lib/auth/tech-helpers';
import { getDriveFileMeta, resolveInterventionFolderByName } from '@/lib/google-drive';

// ── Double garde : tech ASSIGNÉ à l'intervention OU admin. ──────────────
// Ordre important : getCurrentTech RÉUSSIT pour un admin
// (canAccessTechSpace accepte les deux rôles) mais l'ownership
// technicien_id échouerait ensuite — on teste donc le chemin admin
// d'abord, puis le chemin tech + assignation.
export async function guardDocumentsAccess(
  interventionId: string,
): Promise<{ ok: true } | TechAuthFailure> {
  if (await isAdminUser()) return { ok: true };

  const supabase = await createClient();
  const tech = await getCurrentTech(supabase);
  if (!tech.ok) return tech;
  const own = await verifyTechOwnsIntervention(supabase, tech.tech.id, interventionId);
  if (!own.ok) return own;
  return { ok: true };
}

// ── Résolution du dossier Drive de l'intervention. ──────────────────────
// 1. interventions.drive_folder_id (client admin), VALIDÉ par un appel
//    meta (id obsolète/supprimé → on n'en reste pas là) ;
// 2. repli : resolveInterventionFolderByName(ref, year) — year = préfixe
//    numérique de la ref (« 2026-000 » → 2026), sinon année de created_at.
// folderId null = dossier pas encore créé : état NORMAL, pas une erreur.
export async function resolveInterventionFolder(
  interventionId: string,
): Promise<{ ok: true; folderId: string | null } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('interventions')
    .select('ref, created_at, drive_folder_id')
    .eq('id', interventionId)
    .maybeSingle();
  if (error || !data) return { ok: false, error: 'Intervention introuvable.' };
  const iv = data as { ref: string | null; created_at: string | null; drive_folder_id: string | null };

  if (iv.drive_folder_id) {
    const meta = await getDriveFileMeta(iv.drive_folder_id);
    if (meta.ok) return { ok: true, folderId: iv.drive_folder_id };
    // id stocké invalide (dossier déplacé/supprimé) → on tente par nom.
  }

  if (!iv.ref) return { ok: true, folderId: null };
  const refYear = parseInt(iv.ref.split('-')[0] ?? '', 10);
  const year = Number.isFinite(refYear) && refYear > 2000
    ? refYear
    : new Date(iv.created_at ?? Date.now()).getFullYear();
  const folderId = await resolveInterventionFolderByName(iv.ref, year);
  return { ok: true, folderId };
}
