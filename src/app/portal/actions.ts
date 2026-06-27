'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { normalizeLang, PORTAL_LANG_COOKIE } from '@/lib/portal/i18n';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentSyndic } from '@/lib/portal/syndic';
import { notifyStatusChange } from '@/lib/email/notifications';
import { nextRefForYear } from '@/lib/intervention-ref';
import type { Acp } from '@/lib/types/database';

// Service-role pour les inserts qui ont besoin de bypass RLS
// (insert+select returning, ou tables sans policy d'insert pour partner).
function adminOrThrow() {
  return createAdminClient();
}

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

// ── Preference de langue du portail ─────────────────────────────────
// Memorise la langue choisie dans un cookie (lu cote serveur par le layout).
// Le composant LangSwitcher appellera cette action puis router.refresh().
export async function setPortalLang(lang: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(PORTAL_LANG_COOKIE, normalizeLang(lang), {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
}

// ── Notifications ───────────────────────────────────────────────────

// Marque toutes les notifications non lues de l'utilisateur connecté comme
// lues. Best-effort : ne lance jamais d'exception (appelée depuis la cloche).
export async function markMyNotificationsRead(): Promise<void> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return;
    const { error } = await supabase
      .from('notifications')
      .update({ lu: true, lu_at: new Date().toISOString() })
      .eq('destinataire_id', user.id)
      .eq('lu', false);
    if (error) console.error('[markMyNotificationsRead] update KO:', error.message);
  } catch (e) {
    console.error('[markMyNotificationsRead] erreur:', e instanceof Error ? e.message : e);
  }
}

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
  // Coordonnées Nominatim (optionnelles). Strings côté UI car
  // l'AddressAutocomplete les expose en string ; converties en number
  // dans createAcp via parseFloat avant insert (acps.lat/lng = numeric).
  lat?: string | null;
  lng?: string | null;
};

export async function createAcp(input: AcpInput): Promise<ActionResult<Acp>> {
  const session = await getCurrentSyndic();
  if (!session?.org) return { ok: false, error: 'Compte non lié à un partenaire.' };

  const nom = input.nom.trim();
  if (!nom) return { ok: false, error: 'Le nom est obligatoire.' };

  // Service-role : RLS bloquerait le SELECT après INSERT (la policy partner
  // exige un lien intervention qui n'existe pas encore).
  const admin = adminOrThrow();
  const { data, error } = await admin
    .from('acps')
    .insert({
      syndic_id: session.org.id,
      nom,
      adresse: input.adresse.trim() || null,
      ville: input.ville.trim() || null,
      code_postal: input.code_postal.trim() || null,
      bce: input.bce.trim() || null,
      email_rapport: input.email_rapport.trim().toLowerCase() || null,
      email_facturation: input.email_facturation.trim().toLowerCase() || null,
      lat: input.lat ? parseFloat(input.lat) : null,
      lng: input.lng ? parseFloat(input.lng) : null,
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
  // Optionnels — alimentent le JSONB interventions.assureur (nouvelle
  // structure, exposée dans le bloc "Informations assurance" de la fiche).
  reference_sinistre?: string;
  compagnie_assurance?: string;
  // Coordonnées Nominatim du sinistre (optionnelles). Le client les
  // remonte aussi au top-level RequestInput.lat/lng pour l'insert ;
  // conservées ici pour rester self-contained si on consume CourtierStep1
  // ailleurs plus tard.
  lat?: string | null;
  lng?: string | null;
};

export type RequestInput = {
  // Mode syndic
  acp_id?: string | null;
  adresse_precise?: string;
  reference_externe?: string;
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
  // Coordonnées Nominatim (optionnelles) — persistées sur l'intervention
  // (interventions.lat/lng numeric, cf. migration 2026-05-18). En mode
  // syndic, l'ACP a déjà ses coords ; en mode courtier, c'est la seule
  // source pour la géolocalisation du sinistre.
  lat?: string | null;
  lng?: string | null;
};

export async function submitRequest(input: RequestInput): Promise<ActionResult<{ id: string }>> {
  const session = await getCurrentSyndic();
  if (!session?.org) return { ok: false, error: 'Compte non lié à un partenaire.' };
  if (!input.type) return { ok: false, error: 'Type d\'intervention manquant.' };
  if (!input.description.trim()) return { ok: false, error: 'Description manquante.' };

  const isPartner = session.org.type === 'courtier' || session.org.type === 'expert';
  const isExpert = session.org.type === 'expert';

  // Validation et préparation selon le type
  let acpId: string | null = null;
  let adresseLigne: string | null = null;
  let dossierFields: { assure: string; ref_courtier: string } | null = null;
  let assureurJson: {
    assure: string | null;
    nom: string | null;
    email: string | null;
    telephone: string | null;
    reference_sinistre: string | null;
    reference_police: string | null;
  } | null = null;

  if (isPartner) {
    if (!input.courtier) return { ok: false, error: 'Données dossier sinistre manquantes.' };
    const c = input.courtier;
    if (!c.assure_nom.trim()) return { ok: false, error: 'Nom de l\'assuré requis.' };
    if (!c.sinistre_rue.trim() || !c.sinistre_code_postal.trim() || !c.sinistre_ville.trim()) {
      return { ok: false, error: 'Adresse du sinistre complète requise.' };
    }
    if (!isExpert && !c.ref_compagnie.trim()) {
      return { ok: false, error: 'Référence compagnie requise.' };
    }
    adresseLigne = `${c.sinistre_rue.trim()}, ${c.sinistre_code_postal.trim()} ${c.sinistre_ville.trim()}`;
    // Si la référence compagnie est vide (cas expert), on ne crée pas de
    // dossiers_sinistres — l'intervention seule suffit. Le nom de l'assuré
    // n'est donc PAS perdu : il est capturé dans le JSONB assureur.assure
    // ci-dessous, systématiquement pour courtier ET expert.
    const refCourtier = c.ref_compagnie?.trim() || null;
    if (refCourtier !== null) {
      dossierFields = { assure: c.assure_nom.trim(), ref_courtier: refCourtier };
    }

    // JSONB interventions.assureur : on capture TOUJOURS le nom de l'assuré
    // (assure), plus la compagnie / référence sinistre quand elles sont
    // fournies. Garantit que l'assuré est lisible côté portail (liste +
    // détail) même sans dossiers_sinistres.
    const refSinistre = c.reference_sinistre?.trim() || null;
    const compagnieNom = c.compagnie_assurance?.trim() || null;
    assureurJson = {
      assure: c.assure_nom.trim(),
      nom: compagnieNom,
      email: null,
      telephone: null,
      reference_sinistre: refSinistre,
      reference_police: null,
    };
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
      ref: await nextRefForYear(),
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
      demandeur_type: isPartner ? 'courtier' : 'syndic',
      lat: input.lat ? parseFloat(input.lat) : null,
      lng: input.lng ? parseFloat(input.lng) : null,
      ...(assureurJson ? { assureur: assureurJson } : {}),
      ...(assureurJson?.reference_sinistre ? { reference_externe: assureurJson.reference_sinistre } : {}),
      // Ref saisie par le syndic a la creation (mode syndic, exclusif de la ref sinistre partner ci-dessus)
      ...(input.reference_externe?.trim() ? { reference_externe: input.reference_externe.trim() } : {}),
    })
    .select('id, ref')
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
        numero: iv.ref,
        date_ouverture: new Date().toISOString().slice(0, 10),
      });
    if (dossierErr) console.error('[portal] dossier_sinistre insert failed:', JSON.stringify(dossierErr));
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

  // Email automatique à info@foxo.be (best-effort)
  try {
    await notifyStatusChange(iv.id, 'nouvelle');
  } catch (e) {
    console.warn('[portal/submitRequest] notify failed:', e);
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

// ── Référence externe (syndic) ──────────────────────────────────────

// Met à jour la référence externe d'une intervention côté syndic. Vide => null
// (permet d'effacer). Réservé au type 'syndic'. Le filtre syndic_id borne
// l'écriture aux dossiers du syndic courant, même en service-role.
export async function updateReferenceExterne(
  interventionId: string,
  value: string,
): Promise<ActionResult> {
  const session = await getCurrentSyndic();
  if (!session?.org) return { ok: false, error: 'Compte non lié à un partenaire.' };
  if (session.org.type !== 'syndic') {
    return { ok: false, error: 'Action réservée aux syndics.' };
  }

  const ref = value.trim().slice(0, 120);
  const finalValue = ref.length ? ref : null;

  // Service-role pour bypass RLS, mais borné par syndic_id : un syndic ne
  // touche QUE ses propres dossiers. Jamais confiance à un id client seul.
  const admin = adminOrThrow();
  const { data, error } = await admin
    .from('interventions')
    .update({ reference_externe: finalValue })
    .eq('id', interventionId)
    .eq('syndic_id', session.org.id)
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: 'Dossier introuvable ou non autorisé.' };
  }

  revalidatePath(`/portal/interventions/${interventionId}`);
  revalidatePath('/portal/interventions');
  return { ok: true };
}
