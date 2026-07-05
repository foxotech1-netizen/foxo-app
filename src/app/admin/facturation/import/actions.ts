'use server';

// Import Odoo — Server Action. Parse + mappe le CSV (fonctions pures de
// src/lib/facturation/import-odoo.ts), déduplique contre la base, puis :
//   commit=false (DÉFAUT) : n'écrit RIEN — aperçu à blanc obligatoire ;
//   commit=true : insère par lots de 50 et renvoie les compteurs réels.
//
// Déduplication :
//   ventes : skip si une facture porte déjà ce odoo_move_id OU ce numero
//            (sauf collision avec une pièce NON-Odoo : importée sous
//            'ODOO-'+numero et signalée) ;
//   achats : skip si le odoo_move_id est déjà présent (pièces supprimées
//            incluses — un import ne ressuscite pas un achat volontairement
//            supprimé).

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from '@/lib/auth/server';
import { normalizeTva } from '@/lib/agents/extraction-achat';
import {
  parseOdooCsv,
  mapVente,
  mapAchat,
  type VenteImport,
  type AchatImport,
} from '@/lib/facturation/import-odoo';
import type { Fournisseur } from '@/lib/types/database';

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

const BATCH_SIZE = 50;
const APERCU_MAX = 20;

export interface ImportApercuLigne {
  numero: string;
  tiers: string;
  date: string;
  ttc: number;
  statut: string;
  note?: string;
}

export interface ImportRapport {
  lignes_lues: number;
  a_creer: number;
  apercu: ImportApercuLigne[];
  doublons: number;
  ignorees: Array<{ numero: string; raison: string }>;
  /** Sous-totaux de regroupement Odoo écartés (comptés à part des rejets). */
  regroupements: number;
  collisions: string[];
  erreurs: string[];
  /** Compteur réel d'insertions (commit=true uniquement). */
  inserees?: number;
}

// « Nom proche » — même logique que capture.ts (helper privé là-bas, dupliqué
// à l'identique ici pour ne pas modifier le pipeline de capture).
function normName(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}
function nomsProches(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return (na.length >= 4 && nb.includes(na)) || (nb.length >= 4 && na.includes(nb));
}

// Lecture paginée (le client Supabase plafonne à 1000 lignes par select).
async function fetchAllRows(
  admin: ReturnType<typeof createAdminClient>,
  table: string,
  columns: string,
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw new Error(`Lecture ${table} : ${error.message}`);
    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function importOdoo(
  kind: 'ventes' | 'achats',
  csvText: string,
  commit = false,
): Promise<ActionResult<ImportRapport>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  if (!csvText.trim()) return { ok: false, error: 'CSV vide.' };

  try {
    const rows = parseOdooCsv(csvText);
    if (rows.length === 0) {
      return { ok: false, error: 'Aucune ligne lisible dans le CSV (en-têtes attendus : export Odoo FR ou EN).' };
    }
    const rapport = kind === 'ventes'
      ? await importVentes(rows, commit)
      : await importAchats(rows, commit);
    if (commit) {
      revalidatePath('/admin/facturation');
      revalidatePath('/admin/facturation/achats');
      revalidatePath('/admin/facturation/dashboard');
    }
    return { ok: true, data: rapport };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur import.' };
  }
}

// ─── Ventes ─────────────────────────────────────────────────────────────────

async function importVentes(
  rows: Record<string, string>[],
  commit: boolean,
): Promise<ImportRapport> {
  const admin = createAdminClient();

  const ignorees: Array<{ numero: string; raison: string }> = [];
  const pieces: VenteImport[] = [];
  let regroupements = 0;
  for (const row of rows) {
    const res = mapVente(row);
    if (res.ok) pieces.push(res.piece);
    else if (res.regroupement) regroupements += 1;
    else ignorees.push({ numero: res.numero, raison: res.raison });
  }

  // État existant : numéros + odoo_move_id de toutes les factures (y compris
  // supprimées — le numero est UNIQUE en base, une collision ferait échouer
  // l'insert de toute façon).
  const existing = await fetchAllRows(admin, 'factures', 'numero, odoo_move_id');
  const numerosExistants = new Set(existing.map((r) => String(r.numero)));
  const odooIdsExistants = new Set(
    existing.map((r) => r.odoo_move_id).filter((v): v is string => typeof v === 'string' && v.length > 0),
  );

  const collisions: string[] = [];
  let doublons = 0;
  const aCreer: Array<VenteImport & { numeroFinal: string }> = [];
  const vusDansCeFichier = new Set<string>();

  for (const p of pieces) {
    if (vusDansCeFichier.has(p.odoo_move_id)) { doublons += 1; continue; }
    vusDansCeFichier.add(p.odoo_move_id);

    if (odooIdsExistants.has(p.odoo_move_id)) { doublons += 1; continue; }
    let numeroFinal = p.numero;
    if (numerosExistants.has(p.numero)) {
      // Le numéro existe sur une pièce sans odoo_move_id correspondant :
      // pièce NON-Odoo → import sous préfixe, signalé dans le rapport.
      numeroFinal = `ODOO-${p.numero}`;
      if (numerosExistants.has(numeroFinal)) { doublons += 1; continue; }
      collisions.push(p.numero);
    }
    aCreer.push({ ...p, numeroFinal });
  }

  const rapport: ImportRapport = {
    lignes_lues: rows.length,
    a_creer: aCreer.length,
    apercu: aCreer.slice(0, APERCU_MAX).map((p) => ({
      numero: p.numeroFinal,
      tiers: p.client_nom ?? '—',
      date: p.date_emission,
      ttc: p.montant_ttc,
      statut: p.statut,
      note: p.numeroFinal !== p.numero ? 'collision — renumérotée' : undefined,
    })),
    doublons,
    ignorees,
    regroupements,
    collisions,
    erreurs: [],
  };

  if (!commit) return rapport;

  let inserees = 0;
  for (let i = 0; i < aCreer.length; i += BATCH_SIZE) {
    const batch = aCreer.slice(i, i + BATCH_SIZE).map((p) => ({
      type: 'facture',
      numero: p.numeroFinal,
      client_nom: p.client_nom,
      client_bce: p.client_bce,
      lignes: p.lignes,
      details_intervention: {},
      remise_pct: 0,
      remise_globale_valeur: 0,
      remise_globale_type: null,
      remise_globale_description: null,
      tva_pct: p.tva_pct,
      montant_ht: p.montant_ht,
      montant_tva: p.montant_tva,
      montant_ttc: p.montant_ttc,
      notes: null,
      reference: p.reference,
      reference_structuree: null,
      statut: p.statut,
      date_emission: p.date_emission,
      date_echeance: p.date_echeance,
      // date_paiement absente : l'export Odoo ne la fournit pas (documenté).
      is_acompte: false,
      relances_pause: true,
      odoo_move_id: p.odoo_move_id,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await admin.from('factures').insert(batch);
    if (error) {
      rapport.erreurs.push(`Lot ${Math.floor(i / BATCH_SIZE) + 1} : ${error.message}`);
      continue;
    }
    inserees += batch.length;
  }
  rapport.inserees = inserees;
  return rapport;
}

// ─── Achats ─────────────────────────────────────────────────────────────────

async function importAchats(
  rows: Record<string, string>[],
  commit: boolean,
): Promise<ImportRapport> {
  const admin = createAdminClient();

  const ignorees: Array<{ numero: string; raison: string }> = [];
  const pieces: AchatImport[] = [];
  let regroupements = 0;
  for (const row of rows) {
    const res = mapAchat(row);
    if (res.ok) pieces.push(res.piece);
    else if (res.regroupement) regroupements += 1;
    else ignorees.push({ numero: res.numero, raison: res.raison });
  }

  // Déduplication : odoo_move_id déjà présent (pièces supprimées incluses).
  const existing = await fetchAllRows(admin, 'factures_achat', 'odoo_move_id');
  const odooIdsExistants = new Set(
    existing.map((r) => r.odoo_move_id).filter((v): v is string => typeof v === 'string' && v.length > 0),
  );

  let doublons = 0;
  const aCreer: AchatImport[] = [];
  const vusDansCeFichier = new Set<string>();
  for (const p of pieces) {
    if (vusDansCeFichier.has(p.odoo_move_id) || odooIdsExistants.has(p.odoo_move_id)) {
      doublons += 1;
      continue;
    }
    vusDansCeFichier.add(p.odoo_move_id);
    aCreer.push(p);
  }

  const rapport: ImportRapport = {
    lignes_lues: rows.length,
    a_creer: aCreer.length,
    apercu: aCreer.slice(0, APERCU_MAX).map((p) => ({
      numero: p.numero_piece,
      tiers: p.fournisseur_nom,
      date: p.date_facture,
      ttc: p.montant_ttc,
      statut: p.statut,
    })),
    doublons,
    ignorees,
    regroupements,
    collisions: [],
    erreurs: [],
  };

  if (!commit) return rapport;

  // ── Rapprochement fournisseur (TVA puis nom — logique de capture.ts),
  //    création automatique des fiches manquantes (nom + TVA, actif). ──
  const { data: societe } = await admin
    .from('societes')
    .select('id')
    .eq('actif', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  const societeId = (societe?.id as string | undefined) ?? null;

  const fRows = await fetchAllRows(admin, 'fournisseurs', '*');
  const fournisseurs = (fRows as unknown as Fournisseur[]).filter((f) => !f.deleted_at && f.actif);

  const resolveFournisseur = (p: AchatImport): Fournisseur | undefined => {
    const tva = normalizeTva(p.fournisseur_tva);
    return (
      (tva ? fournisseurs.find((f) => normalizeTva(f.tva) === tva) : undefined)
      ?? fournisseurs.find((f) => nomsProches(f.nom, p.fournisseur_nom))
    );
  };

  // Création des fiches manquantes (dédupliquées au sein du fichier).
  for (const p of aCreer) {
    if (resolveFournisseur(p)) continue;
    const { data: created, error } = await admin
      .from('fournisseurs')
      .insert({
        societe_id: societeId,
        nom: p.fournisseur_nom,
        tva: normalizeTva(p.fournisseur_tva),
        actif: true,
      })
      .select('*')
      .single();
    if (error || !created) {
      rapport.erreurs.push(`Fournisseur « ${p.fournisseur_nom} » : ${error?.message ?? 'création échouée'}`);
      continue;
    }
    fournisseurs.push(created as Fournisseur);
  }

  let inserees = 0;
  for (let i = 0; i < aCreer.length; i += BATCH_SIZE) {
    const batch = aCreer.slice(i, i + BATCH_SIZE).map((p) => ({
      societe_id: societeId,
      fournisseur_id: resolveFournisseur(p)?.id ?? null,
      fournisseur_nom: p.fournisseur_nom,
      numero_piece: p.numero_piece,
      date_facture: p.date_facture,
      date_echeance: p.date_echeance,
      devise: 'EUR',
      montant_ht: p.montant_ht,
      montant_tva: p.montant_tva,
      montant_ttc: p.montant_ttc,
      taux_tva: p.taux_tva,
      lignes: [],
      taux_deductibilite: 100,
      source: 'odoo_import',
      statut: p.statut,
      // date_paiement absente : information non portée par l'export Odoo.
      odoo_move_id: p.odoo_move_id,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await admin.from('factures_achat').insert(batch);
    if (error) {
      rapport.erreurs.push(`Lot ${Math.floor(i / BATCH_SIZE) + 1} : ${error.message}`);
      continue;
    }
    inserees += batch.length;
  }
  rapport.inserees = inserees;
  return rapport;
}
