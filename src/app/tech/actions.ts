'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { roleForUserId } from '@/lib/auth/server';
import { syncInterventionToDrive, type DriveSyncResult } from '@/lib/drive';
import { buildTechniques } from '@/lib/rapport/report-data-mapping';
import { techniquesToKeys } from '@/lib/rapport/techniques';

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

// Récupère l'id `utilisateurs` lié à l'email connecté. Garde aussi qu'on est tech.
async function getCurrentTech(): Promise<{ utilisateurId: string | null; email: string } | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || (await roleForUserId(user.id)) !== 'tech') return null;

  const { data: u } = await supabase
    .from('utilisateurs')
    .select('id')
    .eq('email', (user.email ?? '').toLowerCase())
    .maybeSingle();

  return { utilisateurId: u?.id ?? null, email: user.email ?? '' };
}

// Vérifie qu'une intervention appartient bien au tech connecté avant mutation.
async function assertOwnership(interventionId: string): Promise<ActionResult<{ utilisateurId: string }>> {
  const tech = await getCurrentTech();
  if (!tech) return { ok: false, error: 'Accès refusé.' };
  if (!tech.utilisateurId) {
    return { ok: false, error: 'Utilisateur non encodé dans la table utilisateurs.' };
  }
  const supabase = await createClient();
  const { data: iv } = await supabase
    .from('interventions')
    .select('id, technicien_id')
    .eq('id', interventionId)
    .maybeSingle();
  if (!iv) return { ok: false, error: 'Intervention introuvable.' };
  if (iv.technicien_id !== tech.utilisateurId) {
    return { ok: false, error: 'Cette intervention ne t\'est pas assignée.' };
  }
  return { ok: true, data: { utilisateurId: tech.utilisateurId } };
}

export async function startIntervention(interventionId: string): Promise<ActionResult> {
  const own = await assertOwnership(interventionId);
  if (!own.ok) return own;

  const supabase = await createClient();
  const { error } = await supabase
    .from('interventions')
    .update({
      started_at: new Date().toISOString(),
      ended_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', interventionId);

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/tech/interventions/${interventionId}`);
  revalidatePath('/tech');
  return { ok: true };
}

export async function endIntervention(interventionId: string): Promise<ActionResult> {
  const own = await assertOwnership(interventionId);
  if (!own.ok) return own;

  const supabase = await createClient();
  const { error } = await supabase
    .from('interventions')
    .update({
      ended_at: new Date().toISOString(),
      statut: 'realisee',
      updated_at: new Date().toISOString(),
    })
    .eq('id', interventionId);

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/tech/interventions/${interventionId}`);
  revalidatePath('/tech');
  return { ok: true };
}

export type RapportInput = {
  degats: string;
  inspection: string;
  conclusion: string;
  recommandations: string;
};

export async function saveRapport(
  interventionId: string,
  input: RapportInput,
): Promise<ActionResult> {
  const own = await assertOwnership(interventionId);
  if (!own.ok) return own;

  const supabase = await createClient();
  const { error } = await supabase
    .from('rapports')
    .upsert({
      intervention_id: interventionId,
      degats: input.degats,
      inspection: input.inspection,
      conclusion: input.conclusion,
      recommandations: input.recommandations,
      updated_at: new Date().toISOString(),
    });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function publishRapport(
  interventionId: string,
  input: RapportInput,
): Promise<ActionResult> {
  const own = await assertOwnership(interventionId);
  if (!own.ok) return own;

  const required: (keyof RapportInput)[] = ['degats', 'inspection', 'conclusion', 'recommandations'];
  for (const k of required) {
    if (!input[k]?.trim()) return { ok: false, error: `Section "${k}" vide.` };
  }

  const supabase = await createClient();
  const { error: rErr } = await supabase
    .from('rapports')
    .upsert({
      intervention_id: interventionId,
      ...input,
      statut: 'brouillon',
      updated_at: new Date().toISOString(),
    });
  if (rErr) return { ok: false, error: rErr.message };

  const { error: ivErr } = await supabase
    .from('interventions')
    .update({ statut: 'rapport', updated_at: new Date().toISOString() })
    .eq('id', interventionId);
  if (ivErr) return { ok: false, error: ivErr.message };

  // Snapshot des techniques (audit Rapport v2) : à la publication, si le
  // tableau rapports.techniques n'est pas encore figé, on le peuple depuis la
  // dérivation observations_terrain — il devient la source de vérité éditable
  // côté admin. Best-effort, ne bloque pas la publication.
  try {
    const { data: existing } = await supabase
      .from('rapports')
      .select('techniques')
      .eq('intervention_id', interventionId)
      .maybeSingle();
    const current = (existing as { techniques?: string[] | null } | null)?.techniques ?? [];
    if (!current || current.length === 0) {
      const { data: obs } = await supabase
        .from('observations_terrain')
        .select('test_type')
        .eq('intervention_id', interventionId);
      const keys = techniquesToKeys(buildTechniques((obs ?? []) as Array<{ test_type: string }>));
      if (keys.length > 0) {
        await supabase
          .from('rapports')
          .update({ techniques: keys })
          .eq('intervention_id', interventionId);
      }
    }
  } catch (e) {
    console.warn('[publishRapport] snapshot techniques skipped:', e);
  }

  revalidatePath(`/tech/interventions/${interventionId}`);
  revalidatePath('/tech');
  return { ok: true };
}

// Liste les photos d'une intervention. Source primaire :
// `photos_interventions` (Drive). Fallback secondaire pour rétrocompat :
// Supabase Storage bucket `intervention-photos` (avant le passage Drive).
export async function getPhotoSignedUrls(
  interventionId: string,
): Promise<ActionResult<Array<{ name: string; url: string; createdAt: string | null }>>> {
  const own = await assertOwnership(interventionId);
  if (!own.ok) return own;

  const supabase = await createClient();

  // 1. Photos Drive (table photos_interventions)
  const { data: dbRows } = await supabase
    .from('photos_interventions')
    .select('drive_url, filename, uploaded_at')
    .eq('intervention_id', interventionId)
    .order('uploaded_at', { ascending: false });

  const fromDrive = (dbRows ?? []).map((r) => ({
    name: r.filename ?? 'photo',
    url: r.drive_url,
    createdAt: r.uploaded_at,
  }));

  // 2. Fallback Supabase Storage (anciennes photos)
  let fromStorage: Array<{ name: string; url: string; createdAt: string | null }> = [];
  try {
    const { data: list } = await supabase.storage
      .from('intervention-photos')
      .list(interventionId, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
    if (list && list.length > 0) {
      const files = list.filter((f) => !f.name.startsWith('.'));
      const signed = await Promise.all(
        files.map(async (f) => {
          const { data } = await supabase.storage
            .from('intervention-photos')
            .createSignedUrl(`${interventionId}/${f.name}`, 60 * 60 * 24);
          return { name: f.name, url: data?.signedUrl ?? '', createdAt: f.created_at ?? null };
        }),
      );
      fromStorage = signed.filter((s) => s.url);
    }
  } catch { /* noop */ }

  return { ok: true, data: [...fromDrive, ...fromStorage] };
}

export async function triggerDriveSync(interventionId: string): Promise<DriveSyncResult> {
  const own = await assertOwnership(interventionId);
  if (!own.ok) return { ok: false, error: own.error };
  return await syncInterventionToDrive(interventionId);
}
