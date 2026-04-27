'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentSyndic } from '@/lib/portal/syndic';
import type { Acp } from '@/lib/types/database';

// Service-role pour les inserts qui ont besoin de bypass RLS
// (insert+select returning, ou tables sans policy d'insert pour partner).
function adminOrThrow() {
  return createAdminClient();
}

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

// ── ACP ────────────────────────────────────────────────────────────

export async function searchAcp(query: string): Promise<ActionResult<Acp[]>> {
  const q = query.trim();
  if (q.length < 2) return { ok: true, data: [] };

  const supabase = await createClient();
  // Recherche dans nom OU bce. Postgrest .or() prend une chaîne au format
  // "col.op.val,col2.op.val2". On échappe les virgules dans q (improbable
  // pour BCE/nom mais par sécurité).
  const safe = q.replace(/[,()]/g, ' ');
  const { data, error } = await supabase
    .from('acps')
    .select('*')
    .or(`nom.ilike.%${safe}%,bce.ilike.%${safe}%`)
    .limit(8);

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data as Acp[]) ?? [] };
}

export type AcpInput = {
  nom: string;
  adresse: string;
  ville: string;
  code_postal: string;
  bce: string;
  email_rapport: string;
  email_facturation: string;
};

export async function createAcp(input: AcpInput): Promise<ActionResult<Acp>> {
  const session = await getCurrentSyndic();
  if (!session?.org) return { ok: false, error: 'Compte non lié à un syndic.' };

  const nom = input.nom.trim();
  if (!nom) return { ok: false, error: 'Le nom est obligatoire.' };

  // Service-role : RLS bloquerait le SELECT après INSERT (la policy partner
  // exige un lien intervention qui n'existe pas encore).
  const admin = adminOrThrow();
  const { data, error } = await admin
    .from('acps')
    .insert({
      nom,
      adresse: input.adresse.trim() || null,
      ville: input.ville.trim() || null,
      code_postal: input.code_postal.trim() || null,
      bce: input.bce.trim() || null,
      email_rapport: input.email_rapport.trim().toLowerCase() || null,
      email_facturation: input.email_facturation.trim().toLowerCase() || null,
    })
    .select()
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as Acp };
}

// ── Intervention ───────────────────────────────────────────────────

export type OccupantInput = {
  appartement: string;
  nom: string;
  email: string;
  telephone: string;
};

// Variante courtier : pas d'ACP, dossier sinistre à la place.
export type CourtierStep1 = {
  assure_nom: string;
  sinistre_rue: string;
  sinistre_code_postal: string;
  sinistre_ville: string;
  ref_compagnie: string;
};

export type RequestInput = {
  // Mode syndic
  acp_id?: string | null;
  adresse_precise?: string;
  // Mode courtier
  courtier?: CourtierStep1;
  // Commun
  type: string;
  description: string;
  priorite: 'normale' | 'urgente';
  creneau_iso: string | null;
  facturation: {
    nom: string;
    email: string;
    bce: string;
    ref_bon_commande: string;
  };
  occupants: OccupantInput[];
};

function generateRef(): string {
  const year = new Date().getFullYear();
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${year}-${rand}`;
}

export async function submitRequest(input: RequestInput): Promise<ActionResult<{ id: string }>> {
  const session = await getCurrentSyndic();
  if (!session?.org) return { ok: false, error: 'Compte non lié à un partenaire.' };
  if (!input.type) return { ok: false, error: 'Type d\'intervention manquant.' };
  if (!input.description.trim()) return { ok: false, error: 'Description manquante.' };

  const isCourtier = session.org.type === 'courtier';

  // Validation et préparation selon le type
  let acpId: string | null = null;
  let adresseLigne: string | null = null;
  let dossierFields: { assure: string; ref_courtier: string } | null = null;

  if (isCourtier) {
    if (!input.courtier) return { ok: false, error: 'Données dossier sinistre manquantes.' };
    const c = input.courtier;
    if (!c.assure_nom.trim()) return { ok: false, error: 'Nom de l\'assuré requis.' };
    if (!c.sinistre_rue.trim() || !c.sinistre_code_postal.trim() || !c.sinistre_ville.trim()) {
      return { ok: false, error: 'Adresse du sinistre complète requise.' };
    }
    if (!c.ref_compagnie.trim()) return { ok: false, error: 'Référence compagnie requise.' };
    adresseLigne = `${c.sinistre_rue.trim()}, ${c.sinistre_code_postal.trim()} ${c.sinistre_ville.trim()}`;
    dossierFields = { assure: c.assure_nom.trim(), ref_courtier: c.ref_compagnie.trim() };
  } else {
    if (!input.acp_id) return { ok: false, error: 'Immeuble non sélectionné.' };
    acpId = input.acp_id;
    adresseLigne = input.adresse_precise?.trim() || null;
  }

  // Service-role pour bypass RLS sur les inserts (occupants, dossiers_sinistres
  // n'ont pas de policy partner-insert). Sécurité : assertions au-dessus.
  const admin = adminOrThrow();

  const { data: iv, error } = await admin
    .from('interventions')
    .insert({
      ref: generateRef(),
      syndic_id: session.org.id,
      acp_id: acpId,
      type: input.type,
      description: input.description.trim(),
      priorite: input.priorite,
      statut: 'nouvelle',
      creneau_debut: input.creneau_iso,
      adresse: adresseLigne,
      nom_facturation: input.facturation.nom.trim() || null,
      email_facturation: input.facturation.email.trim().toLowerCase() || null,
      bce_facturation: input.facturation.bce.trim() || null,
      ref_bon_commande: input.facturation.ref_bon_commande.trim() || null,
      date_demande: new Date().toISOString().slice(0, 10),
      demandeur_type: isCourtier ? 'courtier' : 'syndic',
    })
    .select('id')
    .single();

  if (error) return { ok: false, error: error.message };

  // Mode courtier : crée le dossier sinistre lié
  if (dossierFields) {
    const { error: dossierErr } = await admin
      .from('dossiers_sinistres')
      .insert({
        intervention_id: iv.id,
        courtier_id: session.org.id,
        assure: dossierFields.assure,
        ref_courtier: dossierFields.ref_courtier,
        date_ouverture: new Date().toISOString().slice(0, 10),
      });
    if (dossierErr) console.warn('[portal] dossier_sinistre insert failed:', dossierErr.message);
  }

  // Insert occupants liés (si fournis)
  const occupantsToInsert = input.occupants
    .filter((o) => o.nom.trim() || o.appartement.trim())
    .map((o) => ({
      intervention_id: iv.id,
      appartement: o.appartement.trim() || null,
      nom: o.nom.trim() || null,
      email: o.email.trim().toLowerCase() || null,
      telephone: o.telephone.trim() || null,
      conf: 'en_attente' as const,
    }));

  if (occupantsToInsert.length > 0) {
    const { error: occErr } = await admin.from('occupants').insert(occupantsToInsert);
    if (occErr) {
      // Intervention créée mais occupants en échec — on remonte l'avertissement,
      // l'intervention existe déjà. À surveiller en log.
      console.warn('[portal] occupants insert failed:', occErr.message);
    }
  }

  revalidatePath('/portal');
  revalidatePath('/portal/interventions');
  return { ok: true, data: { id: iv.id } };
}

export async function submitRequestAndRedirect(input: RequestInput) {
  const res = await submitRequest(input);
  if (res.ok && res.data) {
    redirect(`/portal/interventions/${res.data.id}?created=1`);
  }
  return res;
}
