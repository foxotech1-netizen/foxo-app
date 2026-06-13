'use server';

// Création d'intervention « à froid » (sans planning, sans Agenda, sans
// notification). Réutilise les briques existantes :
//   - nextRefForYear()         (génération de référence — @/lib/intervention-ref)
//   - safeInsertOccupants()    (insertion occupants tolérante — @/lib/cron/check-mails)
//   - types demandeur          (CreateFromSlot* — ../planning/actions)
//
// Différences volontaires avec createInterventionFromSlot (planning) :
//   - AUCUN créneau requis (création à froid).
//   - statut au choix (validé), PAS 'confirmee' en dur.
//   - source: 'admin', creneau_debut/technicien_id optionnels, drive_folder_id null.
//   - PAS de géocodage, PAS de dossier Drive, PAS de token occupant.
//   - PAS de notifyStatusChange, PAS de Google Calendar (création SILENCIEUSE).

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from '@/lib/auth/server';
import { nextRefForYear } from '@/lib/intervention-ref';
import { safeInsertOccupants, type OccupantInsertRow } from '@/lib/cron/check-mails';
import type {
  Acp,
  ParticulierContact,
  PrioriteIntervention,
  StatutIntervention,
} from '@/lib/types/database';
import type {
  ActionResult,
  CreateFromSlotSyndic,
  CreateFromSlotParticulier,
  SlotOccupant,
} from '../planning/actions';

export interface CreateInterventionColdInput {
  ref?: string;                    // vide => auto via nextRefForYear()
  statut?: StatutIntervention;     // défaut 'nouvelle' ; validé contre les 6 valeurs
  type?: string;
  description?: string;
  priorite?: PrioriteIntervention; // défaut 'normale'
  adresse?: string;
  creneau_debut?: string | null;   // ISO, optionnel (date du RDV / réalisation)
  technicien_id?: string | null;   // optionnel
  demandeur: CreateFromSlotSyndic | CreateFromSlotParticulier;
  occupants?: SlotOccupant[];      // même forme d'entrée que createInterventionFromSlot
}

// Source de vérité des 6 statuts autorisés (cf. StatutIntervention).
const VALID_STATUTS: readonly StatutIntervention[] = [
  'nouvelle', 'attente', 'confirmee', 'realisee', 'rapport', 'cloturee',
];

export async function createInterventionCold(
  input: CreateInterventionColdInput,
): Promise<ActionResult<{ intervention_id: string; ref: string }>> {
  // 1. Garde admin (même garde de 2 lignes que planning/actions.ts —
  //    assertAdmin n'y est pas exporté).
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return { ok: false, error: 'Accès refusé.' };
  }

  // 3. Statut validé (défaut 'nouvelle').
  const statut: StatutIntervention = input.statut ?? 'nouvelle';
  if (!VALID_STATUTS.includes(statut)) {
    return { ok: false, error: `Statut invalide : ${String(input.statut)}.` };
  }

  const type = input.type?.trim();
  if (!type) return { ok: false, error: "Type d'intervention requis." };

  const priorite: PrioriteIntervention = input.priorite ?? 'normale';
  const description = input.description?.trim() || null;
  const creneauDebut = input.creneau_debut ?? null;
  const technicienId = input.technicien_id ?? null;
  const nowIso = new Date().toISOString();

  // 4. Payload INSERT — miroir de createInterventionFromSlot (branche syndic /
  //    particulier), MAIS statut au choix, source:'admin', pas de créneau
  //    imposé, pas de Drive, pas de géocodage (lat/lng restent null).
  //    Construit SANS ref ; la ref est injectée à l'INSERT (gestion du retry).
  let basePayload: Record<string, unknown>;

  if (input.demandeur.demandeur_type === 'syndic') {
    const d = input.demandeur;
    if (!d.acp_id) return { ok: false, error: 'ACP requise.' };
    if (!d.syndic_id) return { ok: false, error: 'Syndic requis.' };
    basePayload = {
      acp_id: d.acp_id,
      syndic_id: d.syndic_id,
      technicien_id: technicienId,
      type,
      description,
      priorite,
      statut,
      creneau_debut: creneauDebut,
      adresse: input.adresse?.trim() || null,
      demandeur_type: 'syndic',
      ...(d.billing_override ? { billing_override: d.billing_override } : {}),
      source: 'admin',
      drive_folder_id: null,
      date_demande: nowIso,
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

    const lieuRue = d.lieu.meme_que_mandant ? d.mandant.adresse_facturation.rue : d.lieu.rue;
    const lieuCp = d.lieu.meme_que_mandant ? d.mandant.adresse_facturation.code_postal : d.lieu.cp;
    const lieuVille = d.lieu.meme_que_mandant ? d.mandant.adresse_facturation.ville : d.lieu.ville;
    if (!lieuRue || !lieuCp || !lieuVille) {
      return { ok: false, error: 'Adresse d\'intervention complète requise.' };
    }

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

    basePayload = {
      acp_id: null,
      syndic_id: null,
      technicien_id: technicienId,
      type,
      description,
      priorite,
      statut,
      creneau_debut: creneauDebut,
      adresse: `${lieuRue}, ${lieuCp} ${lieuVille}`,
      demandeur_type: 'particulier',
      particulier_contact: particulierContact,
      source: 'admin',
      drive_folder_id: null,
      date_demande: nowIso,
    };
  }

  // 2 + 5. Référence + INSERT avec retry 1x sur 23505 (réf en double).
  //    - réf AUTO : on régénère et on retente une fois.
  //    - réf FOURNIE par l'utilisateur : on n'écrase pas, on renvoie l'erreur.
  const admin = createAdminClient();
  const refProvided = Boolean(input.ref?.trim());
  let ref = input.ref?.trim() || (await nextRefForYear());

  let insertResult = await admin
    .from('interventions')
    .insert({ ...basePayload, ref })
    .select('id, ref')
    .single();

  if (insertResult.error && (insertResult.error as { code?: string }).code === '23505') {
    if (refProvided) {
      return { ok: false, error: 'Référence déjà utilisée.' };
    }
    ref = await nextRefForYear();
    insertResult = await admin
      .from('interventions')
      .insert({ ...basePayload, ref })
      .select('id, ref')
      .single();
  }

  if (insertResult.error || !insertResult.data) {
    return { ok: false, error: `insert intervention: ${insertResult.error?.message ?? 'échec'}` };
  }

  const interventionId = insertResult.data.id as string;
  const finalRef = (insertResult.data.ref as string | null) ?? ref;

  // 6. Occupants via safeInsertOccupants (best-effort). SlotOccupant n'a pas
  //    de champ `type` → type_occupant défaut 'occupant' ; conf forcé
  //    'en_attente' (type OccupantInsertRow). Pas de token, pas d'insert direct.
  const occInput = input.occupants ?? [];
  const occRows: OccupantInsertRow[] = occInput
    .filter((o) => o.appartement || o.nom || o.prenom || o.email || o.telephone)
    .map((o) => ({
      intervention_id: interventionId,
      appartement: o.appartement || null,
      etage: o.etage || null,
      prenom: o.prenom || null,
      nom: o.nom || null,
      email: o.email || null,
      telephone: o.telephone || null,
      conf: 'en_attente',
      contact_preference: o.contact_preference ?? 'email',
      instructions: o.instructions ?? '',
      type_occupant: 'occupant',
    }));
  if (occRows.length > 0) {
    try {
      const res = await safeInsertOccupants(occRows);
      if (!res.ok) {
        console.error('[createInterventionCold] occupants insert failed:', res.error, { intervention_id: interventionId, rows_count: occRows.length });
      }
    } catch (e) {
      console.error('[createInterventionCold] occupants insert threw:', e instanceof Error ? e.message : String(e));
    }
  }

  // 7. Retour. AUCUNE notification, AUCUN Calendar, AUCUN Drive.
  return { ok: true, data: { intervention_id: interventionId, ref: finalRef } };
}

// Création d'une ACP (immeuble) côté ADMIN — il n'en existait qu'une côté
// portail (src/app/portal/actions.ts, garde syndic). Réutilisée par le
// formulaire de création à froid (création d'ACP à la volée en mode syndic).
// Pas de géocodage (lat/lng restent null).
export async function createAcp(input: {
  nom: string;
  adresse?: string;
  code_postal?: string;
  ville?: string;
  syndic_id?: string | null;
}): Promise<ActionResult<Acp>> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return { ok: false, error: 'Accès refusé.' };
  }

  const nom = input.nom?.trim();
  if (!nom) return { ok: false, error: 'Nom de l\'ACP requis.' };

  const admin = createAdminClient();

  // Le lien ACP→syndic vit dans `syndic_id_ref` (type/migration confirmés) ;
  // le portail pose aussi `syndic_id`. On pose les DEUX par cohérence ; si
  // `syndic_id` n'existe pas en base (42703), on retente sans cette clé.
  const base: Record<string, unknown> = {
    nom,
    adresse: input.adresse?.trim() || null,
    code_postal: input.code_postal?.trim() || null,
    ville: input.ville?.trim() || null,
  };
  if (input.syndic_id) {
    base.syndic_id_ref = input.syndic_id;
    base.syndic_id = input.syndic_id;
  }

  let { data, error } = await admin.from('acps').insert(base).select('*').single();

  if (error && (error as { code?: string }).code === '42703' && base.syndic_id !== undefined) {
    // Colonne `syndic_id` absente — retente en ne gardant que syndic_id_ref.
    const { syndic_id: _omit, ...safe } = base;
    void _omit;
    const retry = await admin.from('acps').insert(safe).select('*').single();
    data = retry.data;
    error = retry.error;
  }

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'Création ACP échouée.' };
  }
  return { ok: true, data: data as Acp };
}
