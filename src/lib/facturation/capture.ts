// Pipeline de capture d'une pièce d'achat (chantier Facturation v2, bloc E).
// Factorisé depuis la route /api/admin/achats/upload pour être partagé entre
// l'upload manuel (canal 'upload') et la relève de la boîte de capture
// (canal 'email' — relève STRICTEMENT manuelle, aucun cron).
//
// Étapes : upload Drive → pieces_capturees → extraction IA → rapprochement
// fournisseur → règles de mapping → détection doublon → factures_achat.
//
// Comportements d'échec :
//   - Drive BLOQUANT (sans justificatif, pas de capture) → { ok: false }.
//   - IA best-effort : la pièce capturée reste 'recue' avec note, une
//     factures_achat VIDE est créée quand même (saisie manuelle possible).

import { createAdminClient } from '@/lib/supabase/admin';
import { uploadAchat } from '@/lib/google-drive';
import {
  extractAchat,
  normalizeTva,
  MAX_ACHAT_BYTES,
  type ExtractionAchat,
} from '@/lib/agents/extraction-achat';
import type { Fournisseur, RegleMapping } from '@/lib/types/database';

export const CAPTURE_ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
// L'API Anthropic plafonne les images à ~5 Mo ; les PDF à ~30 Mo.
export const CAPTURE_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const CAPTURE_MAX_PDF_BYTES = MAX_ACHAT_BYTES;

export interface ProcessPieceArgs {
  /** Contenu du document en base64 STANDARD (pas URL-safe). */
  base64: string;
  mimeType: string;
  nomFichier: string;
  canal: 'upload' | 'email';
  /** Email de l'expéditeur (canal 'email'). */
  sourceEmail?: string | null;
  /** Id du message Gmail source (canal 'email') — sert à la déduplication. */
  sourceMessageId?: string | null;
  /** Email de l'admin à l'origine de la capture (traçabilité). */
  creePar?: string | null;
}

export type ProcessPieceResult =
  | {
      ok: true;
      facture_achat_id: string;
      doublon: boolean;
      confiance_min: number | null;
      extraction_error: string | null;
    }
  | { ok: false; error: string };

function normName(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

// « Nom proche » : égalité insensible à la casse, ou inclusion de l'un dans
// l'autre (≥ 4 caractères pour éviter les faux positifs sur sigles courts).
function nomsProches(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return (na.length >= 4 && nb.includes(na)) || (nb.length >= 4 && na.includes(nb));
}

export async function processerPieceCapturee(args: ProcessPieceArgs): Promise<ProcessPieceResult> {
  const { base64, mimeType, nomFichier, canal, sourceEmail, sourceMessageId, creePar } = args;

  if (!CAPTURE_ALLOWED_MIME.has(mimeType)) {
    return { ok: false, error: `Type non supporté (${mimeType}). Attendu : PDF, jpg, png, webp.` };
  }
  const isPdf = mimeType === 'application/pdf';
  const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
  const maxBytes = isPdf ? CAPTURE_MAX_PDF_BYTES : CAPTURE_MAX_IMAGE_BYTES;
  if (bytes.byteLength === 0) return { ok: false, error: 'Document vide.' };
  if (bytes.byteLength > maxBytes) {
    return {
      ok: false,
      error: `Fichier trop lourd (${Math.round(bytes.byteLength / 1024 / 1024)} Mo, max ${Math.round(maxBytes / 1024 / 1024)} Mo).`,
    };
  }

  const admin = createAdminClient();

  // ── 1. Upload Drive (bloquant : sans justificatif, pas de capture) ──────
  const safeName = (nomFichier || 'facture-achat').replace(/[^\w.\- ()]/g, '_').slice(0, 120);
  const filename = `${new Date().toISOString().slice(0, 10)}_${safeName}`;
  const drive = await uploadAchat({ filename, bytes, mimeType });
  if (!drive.ok) {
    return { ok: false, error: `Upload Drive échoué : ${drive.error}` };
  }

  // ── 2. Pièce capturée (societe = première société active) ───────────────
  const { data: societe } = await admin
    .from('societes')
    .select('id')
    .eq('actif', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  const societeId = (societe?.id as string | undefined) ?? null;

  const { data: piece, error: pieceErr } = await admin
    .from('pieces_capturees')
    .insert({
      canal,
      statut: 'en_extraction',
      societe_id: societeId,
      source_email: sourceEmail ?? null,
      source_message_id: sourceMessageId ?? null,
      nom_fichier: nomFichier || filename,
      mime_type: mimeType,
      drive_file_id: drive.file_id,
      drive_url: drive.web_view_link,
      cree_par: creePar ?? null,
    })
    .select('id')
    .single();
  if (pieceErr || !piece) {
    return { ok: false, error: `Création pièce capturée : ${pieceErr?.message ?? 'inconnue'}` };
  }
  const pieceId = piece.id as string;

  // ── 3. Extraction IA (best-effort) ──────────────────────────────────────
  let extraction: ExtractionAchat | null = null;
  let extractionError: string | null = null;
  try {
    const res = await extractAchat({
      pdfBase64: isPdf ? base64 : undefined,
      imageBase64: isPdf ? undefined : base64,
      imageMediaType: isPdf ? undefined : mimeType,
      sourceRef: pieceId,
    });
    extraction = res.extraction;
  } catch (e) {
    extractionError = e instanceof Error ? e.message : 'Erreur extraction IA.';
  }

  // ── 4. Rapprochement fournisseur ────────────────────────────────────────
  let fournisseurId: string | null = null;
  let fournisseurMatch: Fournisseur | null = null;
  if (extraction?.fournisseur_tva || extraction?.fournisseur_nom) {
    const { data: fRows } = await admin
      .from('fournisseurs')
      .select('*')
      .is('deleted_at', null)
      .eq('actif', true);
    const fournisseurs = (fRows ?? []) as Fournisseur[];
    const tvaExtraite = extraction.fournisseur_tva;
    // Priorité au n° TVA normalisé (identifiant fort), sinon nom proche.
    fournisseurMatch =
      (tvaExtraite
        ? fournisseurs.find((f) => normalizeTva(f.tva) === tvaExtraite)
        : undefined)
      ?? fournisseurs.find((f) => nomsProches(f.nom, extraction!.fournisseur_nom))
      ?? null;
    fournisseurId = fournisseurMatch?.id ?? null;
  }

  // ── 5. Règles de mapping (motif ~ fournisseur_nom, tri priorite) ────────
  let categorieComptable: string | null = null;
  let tauxDeductibilite: number | null = null;
  const nomPourRegles = extraction?.fournisseur_nom ?? fournisseurMatch?.nom ?? null;
  if (nomPourRegles) {
    const { data: rRows } = await admin
      .from('regles_mapping')
      .select('*')
      .eq('actif', true)
      .order('priorite', { ascending: true });
    const regle = ((rRows ?? []) as RegleMapping[]).find((r) =>
      normName(nomPourRegles).includes(normName(r.motif)),
    );
    if (regle) {
      categorieComptable = regle.categorie_comptable;
      tauxDeductibilite = regle.taux_deductibilite;
    }
  }
  if (!categorieComptable && fournisseurMatch?.categorie_comptable_defaut) {
    categorieComptable = fournisseurMatch.categorie_comptable_defaut;
  }

  // ── 6. Détection doublon (même TTC + même date + même fournisseur) ──────
  let doublonDeId: string | null = null;
  if (extraction?.montant_ttc != null && extraction.date_facture) {
    const { data: dRows } = await admin
      .from('factures_achat')
      .select('id, fournisseur_id, fournisseur_nom')
      .is('deleted_at', null)
      .eq('montant_ttc', extraction.montant_ttc)
      .eq('date_facture', extraction.date_facture);
    const doublon = ((dRows ?? []) as Array<{ id: string; fournisseur_id: string | null; fournisseur_nom: string | null }>).find(
      (d) =>
        (fournisseurId && d.fournisseur_id === fournisseurId)
        || nomsProches(d.fournisseur_nom, extraction!.fournisseur_nom),
    );
    doublonDeId = doublon?.id ?? null;
  }

  // ── 7. factures_achat pré-remplie (ou vide si extraction en échec) ──────
  const { data: fa, error: faErr } = await admin
    .from('factures_achat')
    .insert({
      societe_id: societeId,
      fournisseur_id: fournisseurId,
      fournisseur_nom: extraction?.fournisseur_nom ?? null,
      numero_piece: extraction?.numero_piece ?? null,
      date_facture: extraction?.date_facture ?? null,
      date_echeance: extraction?.date_echeance ?? null,
      devise: extraction?.devise ?? 'EUR',
      montant_ht: extraction?.montant_ht ?? null,
      montant_tva: extraction?.montant_tva ?? null,
      montant_ttc: extraction?.montant_ttc ?? null,
      taux_tva: extraction?.taux_tva ?? null,
      lignes: extraction?.lignes ?? [],
      categorie_comptable: categorieComptable,
      taux_deductibilite: tauxDeductibilite ?? 100,
      source: canal,
      justificatif_drive_id: drive.file_id,
      justificatif_url: drive.web_view_link,
      ia_raw: extraction ?? null,
      ia_confiances: extraction?.confiances ?? null,
      ia_confiance_min: extraction?.confiance_min ?? null,
      doublon_de_id: doublonDeId,
      statut: 'a_valider',
      moyen_paiement: extraction?.moyen_paiement ?? null,
      piece_capturee_id: pieceId,
    })
    .select('id')
    .single();
  if (faErr || !fa) {
    return { ok: false, error: `Création facture d'achat : ${faErr?.message ?? 'inconnue'}` };
  }
  const factureAchatId = fa.id as string;

  // ── 8. Statut final de la pièce capturée ────────────────────────────────
  await admin
    .from('pieces_capturees')
    .update(
      extraction
        ? {
            statut: doublonDeId ? 'doublon' : 'extraite',
            type_detecte: extraction.type_detecte,
            extraction: extraction as unknown as Record<string, unknown>,
            confiances: extraction.confiances,
            confiance_min: extraction.confiance_min,
            cible_table: 'factures_achat',
            cible_id: factureAchatId,
            updated_at: new Date().toISOString(),
          }
        : {
            // Échec IA : la pièce reste 'recue' avec note — la facture vide
            // est prête pour la saisie manuelle.
            statut: 'recue',
            note: `Extraction IA échouée : ${(extractionError ?? 'inconnue').slice(0, 400)}`,
            cible_table: 'factures_achat',
            cible_id: factureAchatId,
            updated_at: new Date().toISOString(),
          },
    )
    .eq('id', pieceId);

  return {
    ok: true,
    facture_achat_id: factureAchatId,
    doublon: Boolean(doublonDeId),
    confiance_min: extraction?.confiance_min ?? null,
    extraction_error: extractionError,
  };
}
