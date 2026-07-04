'use server';

// Server Actions du module Achats (factures fournisseurs) + Fournisseurs.
// Pattern maison : garde admin (assertAdmin), écritures via createAdminClient,
// retours ActionResult — cf. src/app/admin/facturation/actions.ts.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from '@/lib/auth/server';
import { normalizeTva } from '@/lib/agents/extraction-achat';
import { pushFactureAchat } from '@/lib/facturation/odoo';
import { listInboxMails, getMailDetail, downloadGmailAttachment } from '@/lib/gmail';
import {
  processerPieceCapturee,
  CAPTURE_ALLOWED_MIME,
  CAPTURE_MAX_IMAGE_BYTES,
  CAPTURE_MAX_PDF_BYTES,
} from '@/lib/facturation/capture';
import type {
  FactureAchat,
  Fournisseur,
  RegleMapping,
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

function normName(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

// ─── Factures d'achat ─────────────────────────────────────────────────────

export interface FactureAchatInput {
  id: string;
  fournisseur_id: string | null;
  fournisseur_nom: string | null;
  numero_piece: string | null;
  date_facture: string | null;
  date_echeance: string | null;
  montant_ht: number | null;
  montant_tva: number | null;
  montant_ttc: number | null;
  taux_tva: number | null;
  categorie_comptable: string | null;
  taux_deductibilite: number | null;
  intervention_id: string | null;
  moyen_paiement: string | null;
  note_admin: string | null;
}

export async function saveFactureAchat(input: FactureAchatInput): Promise<ActionResult> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('factures_achat')
    .update({
      fournisseur_id: input.fournisseur_id,
      fournisseur_nom: input.fournisseur_nom?.trim() || null,
      numero_piece: input.numero_piece?.trim() || null,
      date_facture: input.date_facture || null,
      date_echeance: input.date_echeance || null,
      montant_ht: input.montant_ht,
      montant_tva: input.montant_tva,
      montant_ttc: input.montant_ttc,
      taux_tva: input.taux_tva,
      categorie_comptable: input.categorie_comptable?.trim() || null,
      taux_deductibilite: input.taux_deductibilite ?? 100,
      intervention_id: input.intervention_id,
      moyen_paiement: input.moyen_paiement?.trim() || null,
      note_admin: input.note_admin?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Facture d\'achat introuvable.' };

  revalidatePath('/admin/facturation/achats');
  revalidatePath(`/admin/facturation/achats/${input.id}`);
  return { ok: true };
}

// Création vide pour la saisie manuelle (sans justificatif ni IA).
export async function createFactureAchatManuelle(): Promise<ActionResult<{ id: string }>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const admin = createAdminClient();
  const { data: societe } = await admin
    .from('societes')
    .select('id')
    .eq('actif', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const { data, error } = await admin
    .from('factures_achat')
    .insert({
      societe_id: (societe?.id as string | undefined) ?? null,
      source: 'manuel',
      statut: 'a_valider',
      lignes: [],
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Erreur création.' };

  revalidatePath('/admin/facturation/achats');
  return { ok: true, data: { id: data.id as string } };
}

// Validation : a_valider → a_payer, avec APPRENTISSAGE des règles de mapping.
// Si l'admin a posé/modifié categorie_comptable par rapport à la suggestion
// (règle active matchante, sinon défaut de la fiche fournisseur) ET qu'aucune
// règle ACTIVE ne matche ce fournisseur : insère une règle apprise
// (motif = fournisseur_nom). Si une règle apprise existe déjà pour ce motif
// exact : update + occurrences + 1.
export async function validerFactureAchat(id: string): Promise<ActionResult> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const admin = createAdminClient();
  const { data: row } = await admin
    .from('factures_achat')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!row) return { ok: false, error: 'Facture d\'achat introuvable.' };
  const fa = row as FactureAchat;
  if (fa.statut !== 'a_valider') {
    return { ok: false, error: 'Seule une facture « à valider » peut être validée.' };
  }

  const { error } = await admin
    .from('factures_achat')
    .update({ statut: 'a_payer', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  // ── Apprentissage (best-effort — un échec n'annule pas la validation) ──
  try {
    const nom = (fa.fournisseur_nom ?? '').trim();
    const categorie = (fa.categorie_comptable ?? '').trim();
    if (nom && categorie) {
      const { data: rRows } = await admin
        .from('regles_mapping')
        .select('*')
        .eq('actif', true)
        .order('priorite', { ascending: true });
      const regles = (rRows ?? []) as RegleMapping[];
      const regleActive = regles.find((r) => normName(nom).includes(normName(r.motif)));

      if (!regleActive) {
        // Suggestion en l'absence de règle = défaut de la fiche fournisseur.
        let defautFournisseur: string | null = null;
        if (fa.fournisseur_id) {
          const { data: f } = await admin
            .from('fournisseurs')
            .select('categorie_comptable_defaut')
            .eq('id', fa.fournisseur_id)
            .maybeSingle();
          defautFournisseur = (f?.categorie_comptable_defaut as string | null) ?? null;
        }
        const modifieVsSuggestion = normName(categorie) !== normName(defautFournisseur);

        if (modifieVsSuggestion) {
          const { data: existRows } = await admin
            .from('regles_mapping')
            .select('*')
            .eq('apprise', true)
            .ilike('motif', nom);
          const apprise = ((existRows ?? []) as RegleMapping[])[0];
          if (apprise) {
            await admin
              .from('regles_mapping')
              .update({
                categorie_comptable: categorie,
                taux_deductibilite: fa.taux_deductibilite,
                occurrences: (apprise.occurrences ?? 1) + 1,
                actif: true,
                updated_at: new Date().toISOString(),
              })
              .eq('id', apprise.id);
          } else {
            await admin.from('regles_mapping').insert({
              societe_id: fa.societe_id,
              motif: nom,
              categorie_comptable: categorie,
              taux_deductibilite: fa.taux_deductibilite,
              apprise: true,
              occurrences: 1,
              actif: true,
            });
          }
        }
      }
    }
  } catch (e) {
    console.warn('[validerFactureAchat] apprentissage règle skipped:', e);
  }

  revalidatePath('/admin/facturation/achats');
  revalidatePath(`/admin/facturation/achats/${id}`);
  return { ok: true };
}

export async function rejeterFactureAchat(id: string): Promise<ActionResult> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('factures_achat')
    .update({ statut: 'rejetee', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('statut', 'a_valider')
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Seule une facture « à valider » peut être rejetée.' };

  revalidatePath('/admin/facturation/achats');
  revalidatePath(`/admin/facturation/achats/${id}`);
  return { ok: true };
}

export async function marquerAchatPayee(
  id: string,
  datePaiement: string,
  moyenPaiement: string | null,
): Promise<ActionResult> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePaiement)) {
    return { ok: false, error: 'Date de paiement invalide (YYYY-MM-DD).' };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('factures_achat')
    .update({
      statut: 'payee',
      date_paiement: datePaiement,
      moyen_paiement: moyenPaiement?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('statut', 'a_payer')
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Seule une facture « à payer » peut être marquée payée.' };

  revalidatePath('/admin/facturation/achats');
  revalidatePath(`/admin/facturation/achats/${id}`);
  return { ok: true };
}

// ─── Fournisseurs ─────────────────────────────────────────────────────────

export interface FournisseurInput {
  id?: string;
  nom: string;
  tva?: string | null;
  peppol_id?: string | null;
  email?: string | null;
  telephone?: string | null;
  iban?: string | null;
  adresse?: string | null;
  conditions_paiement_jours?: number | null;
  categorie_comptable_defaut?: string | null;
  notes?: string | null;
  actif?: boolean;
}

export async function saveFournisseur(
  input: FournisseurInput,
): Promise<ActionResult<{ id: string }>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  if (!input.nom?.trim()) return { ok: false, error: 'Nom du fournisseur requis.' };

  const admin = createAdminClient();
  const { data: societe } = await admin
    .from('societes')
    .select('id')
    .eq('actif', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const payload = {
    nom: input.nom.trim(),
    tva: normalizeTva(input.tva) ?? (input.tva?.trim() || null),
    peppol_id: input.peppol_id?.trim() || null,
    email: input.email?.trim().toLowerCase() || null,
    telephone: input.telephone?.trim() || null,
    iban: input.iban?.trim() || null,
    adresse: input.adresse?.trim() || null,
    conditions_paiement_jours: input.conditions_paiement_jours ?? 30,
    categorie_comptable_defaut: input.categorie_comptable_defaut?.trim() || null,
    notes: input.notes?.trim() || null,
    actif: input.actif ?? true,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { data, error } = await admin
      .from('fournisseurs')
      .update(payload)
      .eq('id', input.id)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: 'Fournisseur introuvable.' };
    revalidatePath('/admin/facturation/fournisseurs');
    return { ok: true, data: { id: data.id as string } };
  }

  const { data, error } = await admin
    .from('fournisseurs')
    .insert({ ...payload, societe_id: (societe?.id as string | undefined) ?? null })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Erreur création.' };
  revalidatePath('/admin/facturation/fournisseurs');
  return { ok: true, data: { id: data.id as string } };
}

// Soft delete (deleted_at) — les factures d'achat liées gardent leur lien.
export async function deleteFournisseur(id: string): Promise<ActionResult> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  const admin = createAdminClient();
  const { error } = await admin
    .from('fournisseurs')
    .update({ deleted_at: new Date().toISOString(), actif: false, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/facturation/fournisseurs');
  return { ok: true };
}

// ─── Odoo ─────────────────────────────────────────────────────────────────

// Wrapper Server Action du connecteur Odoo (achats) — garde admin puis
// best-effort (pushFactureAchat ne throw jamais).
export async function pushAchatVersOdoo(
  id: string,
): Promise<ActionResult<{ moveId: number }>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const res = await pushFactureAchat(id);
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath('/admin/facturation/achats');
  revalidatePath(`/admin/facturation/achats/${id}`);
  return { ok: true, data: { moveId: res.moveId } };
}

// ─── Relève de la boîte de capture (STRICTEMENT manuelle — aucun cron) ────

// Plafond de nouvelles pièces traitées par relève : chaque pièce coûte un
// appel modèle (~10-50 s) — on reste sous le budget temps de l'action.
// Relancer la relève traite la suite (déduplication par source_message_id).
const MAX_PIECES_PAR_RELEVE = 5;

export interface ReleveResult {
  messages_vus: number;
  pieces_importees: number;
  doublons: number;
  erreurs: number;
  /** true si le plafond par relève a été atteint — relancer pour continuer. */
  limite_atteinte: boolean;
}

// Relève l'alias de capture (parametres.capture_alias_email) : recherche
// Gmail `to:<alias> has:attachment newer_than:60d`, importe chaque pièce
// jointe PDF/image via processerPieceCapturee (canal 'email'). Déclenchée
// UNIQUEMENT par le clic admin — jamais par un cron.
export async function releverBoiteCapture(): Promise<ActionResult<ReleveResult>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const admin = createAdminClient();
  const { data: param } = await admin
    .from('parametres')
    .select('valeur')
    .eq('cle', 'capture_alias_email')
    .maybeSingle();
  const alias = (param?.valeur ?? '').trim().toLowerCase();
  if (!alias) {
    return {
      ok: false,
      error: 'Alias de capture non configuré — renseigne « capture_alias_email » dans Paramètres → Capture de dépenses.',
    };
  }

  const search = await listInboxMails({
    q: `to:${alias} has:attachment newer_than:60d`,
    limit: 50,
  });
  if (!search.ok) return { ok: false, error: `Recherche Gmail : ${search.error}` };

  let piecesImportees = 0;
  let doublons = 0;
  let erreurs = 0;
  let limiteAtteinte = false;

  for (const mail of search.mails) {
    if (limiteAtteinte) break;
    // Détail (format=full) pour obtenir les attachment_id.
    const detail = await getMailDetail(mail.id);
    if (!detail.ok) { erreurs++; continue; }

    for (const att of detail.mail.attachments) {
      if (limiteAtteinte) break;
      if (!att.attachment_id) continue;
      if (!CAPTURE_ALLOWED_MIME.has(att.mime_type)) continue;
      const maxBytes = att.mime_type === 'application/pdf'
        ? CAPTURE_MAX_PDF_BYTES
        : CAPTURE_MAX_IMAGE_BYTES;
      if (att.size > maxBytes) { erreurs++; continue; }

      // Déduplication : pièce déjà importée lors d'une relève précédente.
      const { data: existing } = await admin
        .from('pieces_capturees')
        .select('id')
        .eq('source_message_id', mail.id)
        .eq('nom_fichier', att.filename)
        .limit(1)
        .maybeSingle();
      if (existing) continue;

      // Best-effort PAR PIÈCE : un échec n'arrête pas la relève.
      try {
        const dataUrlSafe = await downloadGmailAttachment(mail.id, att.attachment_id);
        if (!dataUrlSafe) { erreurs++; continue; }
        // Gmail renvoie du base64 URL-safe → base64 standard pour le pipeline.
        const base64 = Buffer.from(dataUrlSafe, 'base64url').toString('base64');

        const res = await processerPieceCapturee({
          base64,
          mimeType: att.mime_type,
          nomFichier: att.filename,
          canal: 'email',
          sourceEmail: detail.mail.from,
          sourceMessageId: mail.id,
          creePar: user?.email ?? 'admin',
        });
        if (!res.ok) { erreurs++; continue; }
        piecesImportees++;
        if (res.doublon) doublons++;
        if (piecesImportees >= MAX_PIECES_PAR_RELEVE) limiteAtteinte = true;
      } catch {
        erreurs++;
      }
    }
  }

  revalidatePath('/admin/facturation/achats');
  return {
    ok: true,
    data: {
      messages_vus: search.mails.length,
      pieces_importees: piecesImportees,
      doublons,
      erreurs,
      limite_atteinte: limiteAtteinte,
    },
  };
}

// ─── Règles de mapping (enseigne → catégorie comptable) ──────────────────

export interface RegleMappingInput {
  id?: string;
  motif: string;
  categorie_comptable?: string | null;
  taux_deductibilite?: number | null;
  priorite?: number;
  actif?: boolean;
}

export async function saveRegleMapping(
  input: RegleMappingInput,
): Promise<ActionResult<{ id: string }>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  if (!input.motif?.trim()) return { ok: false, error: 'Motif requis.' };
  const taux = input.taux_deductibilite;
  if (taux != null && (!Number.isFinite(taux) || taux < 0 || taux > 100)) {
    return { ok: false, error: 'Déductibilité invalide (0-100).' };
  }

  const admin = createAdminClient();
  const payload = {
    motif: input.motif.trim(),
    categorie_comptable: input.categorie_comptable?.trim() || null,
    taux_deductibilite: taux ?? null,
    priorite: input.priorite ?? 100,
    actif: input.actif ?? true,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { data, error } = await admin
      .from('regles_mapping')
      .update(payload)
      .eq('id', input.id)
      .select('id')
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: 'Règle introuvable.' };
    revalidatePath('/admin/facturation/achats/regles');
    return { ok: true, data: { id: data.id as string } };
  }

  const { data: societe } = await admin
    .from('societes')
    .select('id')
    .eq('actif', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  const { data, error } = await admin
    .from('regles_mapping')
    .insert({ ...payload, societe_id: (societe?.id as string | undefined) ?? null, apprise: false, occurrences: 1 })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Erreur création.' };
  revalidatePath('/admin/facturation/achats/regles');
  return { ok: true, data: { id: data.id as string } };
}

export async function setRegleMappingActif(id: string, actif: boolean): Promise<ActionResult> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  const admin = createAdminClient();
  const { error } = await admin
    .from('regles_mapping')
    .update({ actif, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/facturation/achats/regles');
  return { ok: true };
}

// Suppression DÉFINITIVE (les règles n'ont pas d'historique légal).
export async function deleteRegleMapping(id: string): Promise<ActionResult> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  const admin = createAdminClient();
  const { error } = await admin.from('regles_mapping').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/facturation/achats/regles');
  return { ok: true };
}

// Crée la fiche fournisseur depuis les données extraites d'une facture
// d'achat (nom + TVA) et lie la facture — le « 1 clic » du détail achat.
export async function creerFournisseurDepuisAchat(
  achatId: string,
): Promise<ActionResult<{ fournisseurId: string }>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const admin = createAdminClient();
  const { data: row } = await admin
    .from('factures_achat')
    .select('id, fournisseur_id, fournisseur_nom, ia_raw, categorie_comptable')
    .eq('id', achatId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!row) return { ok: false, error: 'Facture d\'achat introuvable.' };
  if (row.fournisseur_id) return { ok: false, error: 'Un fournisseur est déjà lié.' };
  const nom = (row.fournisseur_nom as string | null)?.trim();
  if (!nom) return { ok: false, error: 'Nom fournisseur manquant — complète-le d\'abord.' };

  const iaRaw = (row.ia_raw ?? {}) as Record<string, unknown>;
  const tva = normalizeTva(typeof iaRaw.fournisseur_tva === 'string' ? iaRaw.fournisseur_tva : null);

  // Anti-doublon : réutilise une fiche existante au même n° TVA ou nom.
  const { data: fRows } = await admin
    .from('fournisseurs')
    .select('id, nom, tva')
    .is('deleted_at', null);
  const existing = ((fRows ?? []) as Pick<Fournisseur, 'id' | 'nom' | 'tva'>[]).find(
    (f) => (tva && normalizeTva(f.tva) === tva) || normName(f.nom) === normName(nom),
  );

  let fournisseurId: string;
  if (existing) {
    fournisseurId = existing.id;
  } else {
    const res = await saveFournisseur({
      nom,
      tva,
      categorie_comptable_defaut: (row.categorie_comptable as string | null) ?? null,
    });
    if (!res.ok) return res;
    fournisseurId = res.data!.id;
  }

  const { error } = await admin
    .from('factures_achat')
    .update({ fournisseur_id: fournisseurId, updated_at: new Date().toISOString() })
    .eq('id', achatId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/admin/facturation/achats/${achatId}`);
  revalidatePath('/admin/facturation/fournisseurs');
  return { ok: true, data: { fournisseurId } };
}
