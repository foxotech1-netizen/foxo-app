'use server';

import { revalidatePath } from 'next/cache';
import { randomBytes } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from "@/lib/auth/server";
import { notifyStatusChange } from '@/lib/email/notifications';
import { createInterventionFolder } from '@/lib/google-drive';
import { createCalendarEvent, createSlotEvent, deleteCalendarEvent } from '@/lib/google-calendar';
import { nextRefForYear } from '@/lib/intervention-ref';
import { proposeCreneau, type ProposeCreneauResult } from '@/lib/mails/propose-creneau';
import { geocodeAddress } from '@/lib/geo/geocode';
import type {
  Acp,
  Organisation,
  ParticulierContact,
  ParticulierMandant,
  ParticulierLieu,
  ParticulierContactSurPlace,
  PrioriteIntervention,
  TypeIntervention,
  TypeOccupant,
  TypeOrganisation,
} from '@/lib/types/database';

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

async function assertAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
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
    .select('id, date, heure_debut, heure_fin, technicien_id');
  if (error) return { ok: false, error: error.message };

  // Sync Calendar (best-effort, non bloquant). Création d'un event
  // "Disponible FoxO" par créneau ; on stocke le google_event_id pour
  // pouvoir supprimer l'event si le créneau est supprimé.
  if (data && data.length > 0) {
    // Charge le nom du tech (une seule fois)
    const { data: tech } = await supabase
      .from('utilisateurs')
      .select('prenom, nom')
      .eq('id', input.technicien_id)
      .maybeSingle();
    const techName = tech ? [tech.prenom, tech.nom].filter(Boolean).join(' ') : undefined;

    for (const slot of data as Array<{ id: string; date: string; heure_debut: string; heure_fin: string }>) {
      try {
        const startIso = new Date(`${slot.date}T${slot.heure_debut}:00`).toISOString();
        const endIso = new Date(`${slot.date}T${slot.heure_fin}:00`).toISOString();
        const r = await createSlotEvent({ startIso, endIso, technicienName: techName });
        if (r.ok) {
          await supabase
            .from('creneaux_disponibles')
            .update({ google_event_id: r.event_id })
            .eq('id', slot.id);
        }
      } catch (e) {
        console.warn('[generateCreneaux] calendar sync skipped:', e);
      }
    }
  }

  const created = data?.length ?? 0;
  revalidatePath('/admin/planning');
  return { ok: true, data: { created, skipped: rows.length - created } };
}

export async function deleteCreneau(creneauId: string): Promise<ActionResult> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  const supabase = await createClient();

  // Récupère l'event_id Calendar avant la suppression DB
  const { data: row } = await supabase
    .from('creneaux_disponibles')
    .select('google_event_id, statut')
    .eq('id', creneauId)
    .maybeSingle();

  const { error } = await supabase
    .from('creneaux_disponibles')
    .delete()
    .eq('id', creneauId)
    .eq('statut', 'libre'); // ne supprime pas un créneau réservé par sécurité
  if (error) return { ok: false, error: error.message };

  // Cleanup Calendar (best-effort)
  if (row?.google_event_id) {
    try { await deleteCalendarEvent(row.google_event_id); } catch { /* noop */ }
  }
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

  // Récupère les event_ids Calendar avant suppression
  const { data: rows } = await supabase
    .from('creneaux_disponibles')
    .select('google_event_id')
    .eq('technicien_id', input.technicien_id)
    .eq('statut', 'libre')
    .gte('date', input.date_debut)
    .lte('date', input.date_fin);

  const { data, error } = await supabase
    .from('creneaux_disponibles')
    .delete()
    .eq('technicien_id', input.technicien_id)
    .eq('statut', 'libre')
    .gte('date', input.date_debut)
    .lte('date', input.date_fin)
    .select('id');
  if (error) return { ok: false, error: error.message };

  // Cleanup Calendar pour chaque slot supprimé (best-effort, non bloquant)
  for (const r of (rows ?? []) as { google_event_id: string | null }[]) {
    if (r.google_event_id) {
      try { await deleteCalendarEvent(r.google_event_id); } catch { /* noop */ }
    }
  }

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

// ─── Création intervention depuis un créneau libre ──────────────────────

export type SlotOccupantConf = 'confirme' | 'en_attente' | 'decline';
export type SlotContactPreference = 'email' | 'sms' | 'whatsapp' | 'both';

export interface SlotOccupant {
  appartement: string;
  etage?: string;
  prenom: string;
  nom: string;
  email: string;
  telephone: string;
  conf?: SlotOccupantConf;
  instructions?: string;
  contact_preference?: SlotContactPreference;
  type_occupant?: TypeOccupant;
}

export interface CreateFromSlotSyndic {
  demandeur_type: 'syndic';
  acp_id: string;
  syndic_id: string;
  occupants: SlotOccupant[];
  // Override facturation optionnel — par défaut l'adresse facturation
  // est celle du syndic (table organisations.adresse).
  billing_override?: { rue: string; cp: string; ville: string; bce?: string };
}

export interface CreateFromSlotParticulier {
  demandeur_type: 'particulier';
  // Nouvelle structure mandant / lieu / contact_sur_place. `particulier`
  // (ancienne structure aplatie) reste pour compat et est dérivé du
  // mandant + lieu côté server.
  mandant: ParticulierMandant;
  lieu: ParticulierLieu;
  contact_sur_place: ParticulierContactSurPlace;
  // Unités additionnelles à inspecter chez un particulier (cave, communs,
  // appartement annexe, voisin impacté…)
  occupants?: SlotOccupant[];
}

export interface CreateFromSlotSyndicBilling {
  // Override facturation : par défaut l'adresse facturation = syndic.
  // Si custom_address est passé, c'est cette adresse qui sera utilisée.
  custom_address?: { rue: string; cp: string; ville: string };
  bce?: string;
}

export interface CreateInterventionFromSlotInput {
  creneau_id: string;
  ref?: string;                  // optionnel — auto-généré si vide
  type: TypeIntervention;
  description: string;
  priorite: PrioriteIntervention;
  adresse_precise?: string;
  demandeur: CreateFromSlotSyndic | CreateFromSlotParticulier;
}

function generateOccupantToken(): string {
  return randomBytes(16).toString('hex');
}

export async function createInterventionFromSlot(
  input: CreateInterventionFromSlotInput,
): Promise<ActionResult<{ intervention_id: string; ref: string }>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const supabase = await createClient();

  // Charge le créneau pour récupérer date/heure/tech
  const { data: creneau, error: creneauErr } = await supabase
    .from('creneaux_disponibles')
    .select('id, date, heure_debut, heure_fin, statut, technicien_id')
    .eq('id', input.creneau_id)
    .maybeSingle();
  if (creneauErr) return { ok: false, error: creneauErr.message };
  if (!creneau) return { ok: false, error: 'Créneau introuvable.' };
  if (creneau.statut !== 'libre') return { ok: false, error: 'Ce créneau n\'est plus libre.' };

  if (!input.type) return { ok: false, error: 'Type d\'intervention manquant.' };
  if (!input.description?.trim()) return { ok: false, error: 'Description requise.' };

  // ISO datetime du créneau
  const creneauIso = new Date(`${creneau.date}T${creneau.heure_debut}:00`).toISOString();
  const ref = input.ref?.trim() || (await nextRefForYear());

  // Branche syndic vs particulier
  let payload: Record<string, unknown>;
  let acpId: string | null = null;
  let syndicId: string | null = null;

  if (input.demandeur.demandeur_type === 'syndic') {
    const d = input.demandeur;
    if (!d.acp_id) return { ok: false, error: 'ACP requise.' };
    if (!d.syndic_id) return { ok: false, error: 'Syndic requis.' };
    acpId = d.acp_id;
    syndicId = d.syndic_id;
    payload = {
      ref,
      acp_id: acpId,
      syndic_id: syndicId,
      technicien_id: creneau.technicien_id,
      type: input.type,
      description: input.description.trim(),
      priorite: input.priorite,
      statut: 'confirmee',
      creneau_debut: creneauIso,
      adresse: input.adresse_precise?.trim() || null,
      demandeur_type: 'syndic',
      ...(d.billing_override ? { billing_override: d.billing_override } : {}),
      date_demande: new Date().toISOString(),
    };
  } else {
    const d = input.demandeur;
    if (!d.mandant?.email) return { ok: false, error: 'Email mandant requis.' };
    if (!d.mandant?.prenom || !d.mandant?.nom) {
      return { ok: false, error: 'Prénom + nom mandant requis.' };
    }
    if (!d.mandant.adresse_facturation?.rue) {
      return { ok: false, error: 'Adresse de facturation requise.' };
    }

    // Adresse intervention : soit même que mandant, soit dérivée de `lieu`
    const lieuRue = d.lieu.meme_que_mandant ? d.mandant.adresse_facturation.rue : d.lieu.rue;
    const lieuCp = d.lieu.meme_que_mandant ? d.mandant.adresse_facturation.code_postal : d.lieu.cp;
    const lieuVille = d.lieu.meme_que_mandant ? d.mandant.adresse_facturation.ville : d.lieu.ville;
    if (!lieuRue || !lieuCp || !lieuVille) {
      return { ok: false, error: 'Adresse d\'intervention complète requise.' };
    }

    // Construit particulier_contact avec champs aplatis (rétrocompat) +
    // nouvelle structure complète (mandant / lieu / contact_sur_place)
    const particulierContact: ParticulierContact = {
      prenom: d.mandant.prenom,
      nom: d.mandant.nom,
      email: d.mandant.email,
      telephone: d.mandant.tel,
      adresse: { rue: lieuRue, code_postal: lieuCp, ville: lieuVille },
      mandant: d.mandant,
      lieu: { meme_que_mandant: d.lieu.meme_que_mandant, rue: lieuRue, cp: lieuCp, ville: lieuVille },
      contact_sur_place: d.contact_sur_place,
    };

    payload = {
      ref,
      acp_id: null,
      syndic_id: null,
      technicien_id: creneau.technicien_id,
      type: input.type,
      description: input.description.trim(),
      priorite: input.priorite,
      statut: 'confirmee',
      creneau_debut: creneauIso,
      adresse: `${lieuRue}, ${lieuCp} ${lieuVille}`,
      demandeur_type: 'particulier',
      particulier_contact: particulierContact,
      date_demande: new Date().toISOString(),
    };
  }

  // Service-role pour l'INSERT + SELECT (RLS partner = pas de SELECT sans
  // lien existant → on bypass).
  const admin = createAdminClient();
  const { data: iv, error: ivErr } = await admin
    .from('interventions')
    .insert(payload)
    .select('id, ref')
    .single();
  if (ivErr) return { ok: false, error: ivErr.message };
  const interventionId = iv.id as string;

  // Réserve le créneau
  const { error: rErr } = await supabase
    .from('creneaux_disponibles')
    .update({ statut: 'reserve', intervention_id: interventionId })
    .eq('id', creneau.id)
    .eq('statut', 'libre');
  if (rErr) return { ok: false, error: rErr.message };

  // Appartements/unités à inspecter avec tokens individuels.
  // Supporté en mode syndic ET particulier (le particulier peut avoir
  // plusieurs unités : cave, communs, voisin impacté, etc.).
  const allOccupants: SlotOccupant[] =
    input.demandeur.demandeur_type === 'syndic'
      ? input.demandeur.occupants
      : input.demandeur.occupants ?? [];
  if (allOccupants.length > 0) {
    const rows = allOccupants
      .filter((o) => o.appartement || o.nom || o.prenom || o.email || o.telephone)
      .map((o) => ({
        intervention_id: interventionId,
        appartement: o.appartement || null,
        etage: o.etage || null,
        prenom: o.prenom || null,
        nom: o.nom || null,
        email: o.email || null,
        telephone: o.telephone || null,
        instructions: o.instructions || null,
        token: generateOccupantToken(),
        conf: o.conf ?? null,
        contact_preference: o.contact_preference ?? 'email',
        type_occupant: o.type_occupant ?? 'occupant',
      }));
    if (rows.length > 0) {
      await admin.from('occupants').insert(rows);
    }
  }

  // Dossier Drive placeholder (no-op si Google non configuré)
  try {
    let adresse = '';
    if (acpId) {
      const { data: acp } = await supabase.from('acps').select('adresse, code_postal, ville').eq('id', acpId).maybeSingle();
      if (acp) adresse = [acp.adresse, acp.code_postal, acp.ville].filter(Boolean).join(', ');
    } else if (input.demandeur.demandeur_type === 'particulier') {
      const d = input.demandeur;
      const rue = d.lieu.meme_que_mandant ? d.mandant.adresse_facturation.rue : d.lieu.rue;
      const cp = d.lieu.meme_que_mandant ? d.mandant.adresse_facturation.code_postal : d.lieu.cp;
      const ville = d.lieu.meme_que_mandant ? d.mandant.adresse_facturation.ville : d.lieu.ville;
      adresse = `${rue}, ${cp} ${ville}`;
    }
    const driveRes = await createInterventionFolder({ ref, adresse, year: new Date().getFullYear() });
    if (driveRes.ok && driveRes.folder_id) {
      const { error: driveUpdErr } = await admin
        .from('interventions')
        .update({ drive_folder_id: driveRes.folder_id, updated_at: new Date().toISOString() })
        .eq('id', interventionId);
      if (driveUpdErr) console.warn('[planning/createIntervention] persist drive_folder_id skipped:', driveUpdErr.message);
    }
  } catch (e) {
    console.warn('[planning/createIntervention] Drive folder skipped:', e);
  }

  // Email syndic + occupants (best-effort, non bloquant)
  try {
    await notifyStatusChange(interventionId, 'confirmee');
  } catch (e) {
    console.warn('[planning/createIntervention] notifyStatusChange skipped:', e);
  }

  // Google Calendar (best-effort)
  try {
    const startIso = creneauIso;
    // Fin = créneau de heure_fin
    const endIso = new Date(`${creneau.date}T${creneau.heure_fin}:00`).toISOString();
    const summary = `FoxO ${ref} — ${input.type ?? 'Intervention'}`;
    const description = input.description?.trim().slice(0, 500) ?? '';
    let location = '';
    if (acpId) {
      const { data: acp } = await supabase.from('acps').select('adresse, code_postal, ville').eq('id', acpId).maybeSingle();
      if (acp) location = [acp.adresse, acp.code_postal, acp.ville].filter(Boolean).join(', ');
    } else if (input.demandeur.demandeur_type === 'particulier') {
      const d = input.demandeur;
      const rue = d.lieu.meme_que_mandant ? d.mandant.adresse_facturation.rue : d.lieu.rue;
      const cp = d.lieu.meme_que_mandant ? d.mandant.adresse_facturation.code_postal : d.lieu.cp;
      const ville = d.lieu.meme_que_mandant ? d.mandant.adresse_facturation.ville : d.lieu.ville;
      location = `${rue}, ${cp} ${ville}`;
    }
    await createCalendarEvent({ startIso, endIso, summary, description, location });
  } catch (e) {
    console.warn('[planning/createIntervention] createCalendarEvent skipped:', e);
  }

  revalidatePath('/admin/planning');
  revalidatePath('/admin');
  return { ok: true, data: { intervention_id: interventionId, ref } };
}

// ─── Édition d'un créneau réservé ────────────────────────────────────────

export async function freeSlot(input: { creneau_id: string }): Promise<ActionResult> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  const supabase = await createClient();

  const { data: creneau } = await supabase
    .from('creneaux_disponibles')
    .select('id, intervention_id, statut')
    .eq('id', input.creneau_id)
    .maybeSingle();
  if (!creneau || creneau.statut !== 'reserve') {
    return { ok: false, error: 'Ce créneau n\'est pas réservé.' };
  }

  // Libère le créneau
  const { error } = await supabase
    .from('creneaux_disponibles')
    .update({ statut: 'libre', intervention_id: null })
    .eq('id', creneau.id);
  if (error) return { ok: false, error: error.message };

  // Repasse l'intervention en 'attente' + retire le créneau
  if (creneau.intervention_id) {
    await supabase
      .from('interventions')
      .update({ statut: 'attente', creneau_debut: null, updated_at: new Date().toISOString() })
      .eq('id', creneau.intervention_id);
  }

  revalidatePath('/admin/planning');
  revalidatePath('/admin');
  return { ok: true };
}

export async function moveIntervention(input: {
  from_creneau_id: string;
  to_creneau_id: string;
}): Promise<ActionResult> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  const supabase = await createClient();

  const { data: from } = await supabase
    .from('creneaux_disponibles')
    .select('id, intervention_id, statut')
    .eq('id', input.from_creneau_id)
    .maybeSingle();
  if (!from || from.statut !== 'reserve' || !from.intervention_id) {
    return { ok: false, error: 'Créneau d\'origine invalide.' };
  }

  const { data: to } = await supabase
    .from('creneaux_disponibles')
    .select('id, date, heure_debut, statut, technicien_id')
    .eq('id', input.to_creneau_id)
    .maybeSingle();
  if (!to || to.statut !== 'libre') {
    return { ok: false, error: 'Créneau de destination indisponible.' };
  }

  // Libère l'ancien
  const { error: e1 } = await supabase
    .from('creneaux_disponibles')
    .update({ statut: 'libre', intervention_id: null })
    .eq('id', from.id);
  if (e1) return { ok: false, error: e1.message };

  // Réserve le nouveau
  const { error: e2 } = await supabase
    .from('creneaux_disponibles')
    .update({ statut: 'reserve', intervention_id: from.intervention_id })
    .eq('id', to.id)
    .eq('statut', 'libre');
  if (e2) return { ok: false, error: e2.message };

  // Met à jour l'intervention
  const newIso = new Date(`${to.date}T${to.heure_debut}:00`).toISOString();
  await supabase
    .from('interventions')
    .update({
      creneau_debut: newIso,
      technicien_id: to.technicien_id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', from.intervention_id);

  revalidatePath('/admin/planning');
  revalidatePath('/admin');
  return { ok: true };
}

export async function updateInterventionFromSlot(input: {
  intervention_id: string;
  description?: string;
  technicien_id?: string | null;
  statut?: 'confirmee' | 'realisee' | 'rapport' | 'cloturee' | 'attente' | 'en_suspens';
}): Promise<ActionResult> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  const supabase = await createClient();

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof input.description === 'string') patch.description = input.description;
  if (input.technicien_id !== undefined) patch.technicien_id = input.technicien_id;
  if (input.statut) patch.statut = input.statut;

  const { error } = await supabase
    .from('interventions')
    .update(patch)
    .eq('id', input.intervention_id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/planning');
  revalidatePath('/admin');
  return { ok: true };
}

// ─── Créneaux bloqués ────────────────────────────────────────────────────

export async function deleteBlockedSlot(id: string): Promise<ActionResult> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  const supabase = await createClient();
  const { error } = await supabase.from('creneaux_bloques').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/planning');
  return { ok: true };
}

export async function updateBlockedSlot(input: { id: string; motif: string }): Promise<ActionResult> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  const supabase = await createClient();
  const { error } = await supabase
    .from('creneaux_bloques')
    .update({ motif: input.motif })
    .eq('id', input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/planning');
  return { ok: true };
}

// ─── Helpers de recherche pour le modal ──────────────────────────────────

export async function searchAcps(query: string): Promise<ActionResult<Acp[]>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  const q = query.trim();
  if (q.length < 2) return { ok: true, data: [] };
  const safe = q.replace(/[,()]/g, ' ');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('acps')
    .select('*')
    .or(`nom.ilike.%${safe}%,bce.ilike.%${safe}%`)
    .limit(8);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as Acp[] };
}

// Recherche d'organisations par nom/email. `opts.types` restreint au besoin
// aux rôles voulus (ex. ['courtier', 'expert'] pour le mandat sur dossier) ;
// sans filtre, comporte­ment historique inchangé (tous types).
export async function searchOrganisations(
  query: string,
  opts?: { types?: TypeOrganisation[] },
): Promise<ActionResult<Organisation[]>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  const q = query.trim();
  if (q.length < 2) return { ok: true, data: [] };
  const safe = q.replace(/[,()]/g, ' ');
  const supabase = await createClient();
  let qb = supabase
    .from('organisations')
    .select('*')
    .or(`nom.ilike.%${safe}%,email.ilike.%${safe}%`);
  if (opts?.types && opts.types.length > 0) {
    qb = qb.in('type', opts.types);
  }
  const { data, error } = await qb.limit(8);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as Organisation[] };
}

export async function listFreeSlotsForMove(args: {
  technicien_id?: string | null;
  from_date: string;     // YYYY-MM-DD
  to_date: string;       // YYYY-MM-DD
}): Promise<ActionResult<Array<{ id: string; date: string; heure_debut: string; heure_fin: string; technicien_id: string | null }>>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  const supabase = await createClient();
  let q = supabase
    .from('creneaux_disponibles')
    .select('id, date, heure_debut, heure_fin, technicien_id')
    .eq('statut', 'libre')
    .gte('date', args.from_date)
    .lte('date', args.to_date)
    .order('date', { ascending: true })
    .order('heure_debut', { ascending: true })
    .limit(50);
  if (args.technicien_id) q = q.eq('technicien_id', args.technicien_id);
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data ?? [] };
}

export async function getInterventionForSlot(id: string): Promise<ActionResult<{
  id: string;
  ref: string | null;
  type: string | null;
  description: string | null;
  statut: string;
  acp_nom: string | null;
  syndic_nom: string | null;
  technicien_id: string | null;
  particulier_nom: string | null;
}>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('interventions')
    .select('id, ref, type, description, statut, technicien_id, particulier_contact, acp:acps(nom), syndic:organisations(nom)')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return { ok: false, error: error?.message ?? 'Intervention introuvable.' };
  type Row = {
    id: string; ref: string | null; type: string | null; description: string | null;
    statut: string; technicien_id: string | null;
    particulier_contact: { prenom?: string; nom?: string } | null;
    acp: { nom: string | null } | null;
    syndic: { nom: string | null } | null;
  };
  const r = data as unknown as Row;
  return {
    ok: true,
    data: {
      id: r.id,
      ref: r.ref,
      type: r.type,
      description: r.description,
      statut: r.statut,
      acp_nom: r.acp?.nom ?? null,
      syndic_nom: r.syndic?.nom ?? null,
      technicien_id: r.technicien_id,
      particulier_nom: r.particulier_contact
        ? `${r.particulier_contact.prenom ?? ''} ${r.particulier_contact.nom ?? ''}`.trim() || null
        : null,
    },
  };
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

// ─── Suggestion de créneau (lecture seule) ───────────────────────────────
//
// Wrapper server action exposant proposeCreneau() au client. proposeCreneau
// est server-only (createAdminClient) et ne peut pas être appelée depuis un
// composant 'use client' → on passe par cette action.
//
// Géocode l'adresse (best-effort, null si rien) puis délègue le scoring à
// proposeCreneau. Aucune mutation : ne réserve ni ne crée rien.
export async function proposeSlotForIntervention(params: {
  adresse: string | null;
  urgence: boolean;
}): Promise<ProposeCreneauResult> {
  const guard = await assertAdmin();
  if (!guard.ok) return { primary: null, alternative: null, fenetre_etendue: false };

  let lat: number | null = null;
  let lng: number | null = null;
  const adresse = params.adresse?.trim();
  if (adresse) {
    const geo = await geocodeAddress(adresse);
    if (geo) {
      lat = geo.lat;
      lng = geo.lng;
    }
  }

  return proposeCreneau({ adresse_lat: lat, adresse_lng: lng, urgence: params.urgence });
}
