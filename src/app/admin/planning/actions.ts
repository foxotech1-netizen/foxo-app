'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

async function assertAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return { ok: false, error: 'Accès refusé.' };
  }
  return { ok: true };
}

export interface GenerateCreneauxInput {
  technicien_id: string;
  date_debut: string;        // YYYY-MM-DD
  date_fin: string;          // YYYY-MM-DD
  jours: number[];           // 0=Lun, 1=Mar, …, 6=Dim
  plages: { debut: string; fin: string }[]; // [{debut:'09:00', fin:'10:30'}, …]
}

export async function generateCreneaux(
  input: GenerateCreneauxInput,
): Promise<ActionResult<{ created: number; skipped: number }>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  if (!input.technicien_id) return { ok: false, error: 'Technicien manquant.' };
  if (!input.date_debut || !input.date_fin) return { ok: false, error: 'Période invalide.' };
  if (!input.jours.length) return { ok: false, error: 'Sélectionne au moins un jour de la semaine.' };
  if (!input.plages.length) return { ok: false, error: 'Sélectionne au moins une plage horaire.' };

  const start = new Date(input.date_debut + 'T00:00:00');
  const end = new Date(input.date_fin + 'T00:00:00');
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) {
    return { ok: false, error: 'Période invalide.' };
  }

  // Génère toutes les combinaisons (date × plage) en filtrant par jour de la semaine.
  const rows: Array<{
    technicien_id: string;
    date: string;
    heure_debut: string;
    heure_fin: string;
    statut: 'libre';
  }> = [];

  const cur = new Date(start);
  while (cur <= end) {
    // 0=Dim → on ramène à 0=Lun pour matcher l'UI
    const dow = (cur.getDay() + 6) % 7;
    if (input.jours.includes(dow)) {
      const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
      for (const p of input.plages) {
        rows.push({
          technicien_id: input.technicien_id,
          date: iso,
          heure_debut: p.debut,
          heure_fin: p.fin,
          statut: 'libre',
        });
      }
    }
    cur.setDate(cur.getDate() + 1);
  }

  if (!rows.length) return { ok: false, error: 'Aucun créneau à générer (jours/période ne se croisent pas).' };

  const supabase = await createClient();
  // upsert avec onConflict (technicien_id, date, heure_debut) — préserve les
  // créneaux déjà réservés s'il y en a, sinon recrée comme libre.
  const { data, error } = await supabase
    .from('creneaux_disponibles')
    .upsert(rows, { onConflict: 'technicien_id,date,heure_debut', ignoreDuplicates: true })
    .select('id');
  if (error) return { ok: false, error: error.message };

  const created = data?.length ?? 0;
  revalidatePath('/admin/planning');
  return { ok: true, data: { created, skipped: rows.length - created } };
}

export async function deleteCreneau(creneauId: string): Promise<ActionResult> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  const supabase = await createClient();
  const { error } = await supabase
    .from('creneaux_disponibles')
    .delete()
    .eq('id', creneauId)
    .eq('statut', 'libre'); // ne supprime pas un créneau réservé par sécurité
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/planning');
  return { ok: true };
}

export async function deleteCreneauxRange(input: {
  technicien_id: string;
  date_debut: string;
  date_fin: string;
}): Promise<ActionResult<{ deleted: number }>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('creneaux_disponibles')
    .delete()
    .eq('technicien_id', input.technicien_id)
    .eq('statut', 'libre')
    .gte('date', input.date_debut)
    .lte('date', input.date_fin)
    .select('id');
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/planning');
  return { ok: true, data: { deleted: data?.length ?? 0 } };
}

export async function reserveCreneau(input: {
  creneau_id: string;
  intervention_id: string;
}): Promise<ActionResult> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  const supabase = await createClient();
  const { error } = await supabase
    .from('creneaux_disponibles')
    .update({ statut: 'reserve', intervention_id: input.intervention_id })
    .eq('id', input.creneau_id)
    .eq('statut', 'libre');
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/planning');
  revalidatePath('/admin');
  return { ok: true };
}

export async function blockCreneau(input: {
  date: string;
  heure?: string;
  technicien_id?: string;
  motif?: string;
}): Promise<ActionResult> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  const supabase = await createClient();
  const { error } = await supabase
    .from('creneaux_bloques')
    .insert({
      date: input.date,
      heure: input.heure ?? null,
      technicien_id: input.technicien_id ?? null,
      motif: input.motif ?? null,
    });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/planning');
  return { ok: true };
}
