'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertAdmin } from '@/lib/auth/assert';
import type { CategorieNoteFrais, NoteFrais, StatutNoteFrais } from '@/lib/types/database';

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ── Liste (admin : toutes ; tech : les siennes) ──────────────────────────────
export async function getNotesFrais(filters?: {
  statut?: StatutNoteFrais;
  technicien_email?: string;
  from?: string;
  to?: string;
}): Promise<ActionResult<NoteFrais[]>> {
  const supabase = createAdminClient();
  let q = supabase
    .from('notes_frais')
    .select('*')
    .is('deleted_at', null)
    .order('date_depense', { ascending: false });

  if (filters?.statut)            q = q.eq('statut', filters.statut);
  if (filters?.technicien_email)  q = q.eq('technicien_email', filters.technicien_email);
  if (filters?.from)              q = q.gte('date_depense', filters.from);
  if (filters?.to)                q = q.lte('date_depense', filters.to);

  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as NoteFrais[] };
}

// ── Création ─────────────────────────────────────────────────────────────────
export async function createNoteFrais(payload: {
  technicien_email: string;
  technicien_nom?: string;
  titre: string;
  categorie: CategorieNoteFrais;
  montant_htva: number;
  taux_tva: number;
  montant_ttc: number;
  fournisseur?: string;
  date_depense: string;
  description?: string;
  intervention_id?: string;
}): Promise<ActionResult<NoteFrais>> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('notes_frais')
    .insert({ ...payload, statut: 'brouillon' })
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/notes-frais');
  return { ok: true, data: data as NoteFrais };
}

// ── Mise à jour statut (admin seulement) ─────────────────────────────────────
export async function updateStatutNoteFrais(
  id: string,
  statut: StatutNoteFrais,
  note_admin?: string,
  approver_email?: string,
): Promise<ActionResult> {
  await assertAdmin();
  const supabase = createAdminClient();
  const patch: Record<string, unknown> = { statut };
  if (note_admin !== undefined) patch.note_admin = note_admin;
  if (statut === 'approuvee') {
    patch.approved_at = new Date().toISOString();
    patch.approved_by = approver_email ?? null;
  }
  const { error } = await supabase.from('notes_frais').update(patch).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/notes-frais');
  return { ok: true, data: undefined };
}

// ── Édition admin des champs (catégorie, montants, date, description…) ───────
export async function updateNoteFraisAdmin(
  id: string,
  patch: {
    titre?: string;
    categorie?: CategorieNoteFrais;
    montant_htva?: number;
    taux_tva?: number;
    montant_ttc?: number;
    fournisseur?: string | null;
    date_depense?: string;
    description?: string | null;
  },
): Promise<ActionResult<NoteFrais>> {
  await assertAdmin();

  const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.titre !== undefined) {
    if (!patch.titre.trim()) return { ok: false, error: 'Titre requis.' };
    upd.titre = patch.titre.trim();
  }
  if (patch.categorie !== undefined) upd.categorie = patch.categorie;
  if (patch.montant_htva !== undefined) {
    if (!Number.isFinite(patch.montant_htva) || patch.montant_htva < 0) {
      return { ok: false, error: 'Montant HTVA invalide.' };
    }
    upd.montant_htva = patch.montant_htva;
  }
  if (patch.taux_tva !== undefined) {
    if (!Number.isFinite(patch.taux_tva) || patch.taux_tva < 0 || patch.taux_tva > 100) {
      return { ok: false, error: 'Taux TVA invalide.' };
    }
    upd.taux_tva = patch.taux_tva;
  }
  if (patch.montant_ttc !== undefined) {
    if (!Number.isFinite(patch.montant_ttc) || patch.montant_ttc <= 0) {
      return { ok: false, error: 'Montant TTC invalide.' };
    }
    upd.montant_ttc = patch.montant_ttc;
  }
  if (patch.fournisseur !== undefined) upd.fournisseur = patch.fournisseur?.trim() || null;
  if (patch.date_depense !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.date_depense)) {
      return { ok: false, error: 'Date invalide (YYYY-MM-DD).' };
    }
    upd.date_depense = patch.date_depense;
  }
  if (patch.description !== undefined) upd.description = patch.description?.trim() || null;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('notes_frais')
    .update(upd)
    .eq('id', id)
    .is('deleted_at', null)
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Note introuvable.' };
  revalidatePath('/admin/notes-frais');
  return { ok: true, data: data as NoteFrais };
}

// ── Soft-delete ───────────────────────────────────────────────────────────────
export async function deleteNoteFrais(id: string): Promise<ActionResult> {
  await assertAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('notes_frais')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/notes-frais');
  return { ok: true, data: undefined };
}
