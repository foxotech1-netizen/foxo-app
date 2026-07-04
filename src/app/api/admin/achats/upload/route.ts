// POST /api/admin/achats/upload — capture d'une facture fournisseur.
//
// Pipeline : upload Drive (FACTURES/Achats/<année>) → pieces_capturees →
// extraction IA (agent extraction_achat) → rapprochement fournisseur →
// règles de mapping → détection doublon → factures_achat 'a_valider'.
//
// Best-effort : si l'extraction IA échoue, la pièce capturée repasse en
// statut 'recue' avec une note, et une factures_achat VIDE est créée quand
// même (saisie manuelle possible) — l'upload n'échoue JAMAIS pour cause
// d'IA. Seul un échec d'upload Drive (perte du justificatif) est bloquant.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from '@/lib/auth/server';
import { uploadAchat } from '@/lib/google-drive';
import {
  extractAchat,
  normalizeTva,
  MAX_ACHAT_BYTES,
  type ExtractionAchat,
} from '@/lib/agents/extraction-achat';
import type { Fournisseur, RegleMapping } from '@/lib/types/database';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
// L'API Anthropic plafonne les images à ~5 Mo ; les PDF à ~30 Mo.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

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

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'Form-data attendu.' }, { status: 400 });
  }
  const file = formData.get('fichier');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ ok: false, error: 'Fichier vide ou absent (champ « fichier »).' }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { ok: false, error: `Type non supporté (${file.type}). Attendu : PDF, jpg, png, webp.` },
      { status: 400 },
    );
  }
  const isPdf = file.type === 'application/pdf';
  const maxBytes = isPdf ? MAX_ACHAT_BYTES : MAX_IMAGE_BYTES;
  if (file.size > maxBytes) {
    return NextResponse.json(
      { ok: false, error: `Fichier trop lourd (${Math.round(file.size / 1024 / 1024)} Mo, max ${Math.round(maxBytes / 1024 / 1024)} Mo).` },
      { status: 400 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const admin = createAdminClient();

  // ── 1. Upload Drive (bloquant : sans justificatif, pas de capture) ──────
  const safeName = (file.name || 'facture-achat').replace(/[^\w.\- ()]/g, '_').slice(0, 120);
  const filename = `${new Date().toISOString().slice(0, 10)}_${safeName}`;
  const drive = await uploadAchat({ filename, bytes, mimeType: file.type });
  if (!drive.ok) {
    return NextResponse.json(
      { ok: false, error: `Upload Drive échoué : ${drive.error}` },
      { status: 502 },
    );
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
      canal: 'upload',
      statut: 'en_extraction',
      societe_id: societeId,
      nom_fichier: file.name || filename,
      mime_type: file.type,
      drive_file_id: drive.file_id,
      drive_url: drive.web_view_link,
      cree_par: user.email ?? 'admin',
    })
    .select('id')
    .single();
  if (pieceErr || !piece) {
    return NextResponse.json(
      { ok: false, error: `Création pièce capturée : ${pieceErr?.message ?? 'inconnue'}` },
      { status: 500 },
    );
  }
  const pieceId = piece.id as string;

  // ── 3. Extraction IA (best-effort) ──────────────────────────────────────
  const base64 = Buffer.from(bytes).toString('base64');
  let extraction: ExtractionAchat | null = null;
  let extractionError: string | null = null;
  try {
    const res = await extractAchat({
      pdfBase64: isPdf ? base64 : undefined,
      imageBase64: isPdf ? undefined : base64,
      imageMediaType: isPdf ? undefined : file.type,
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
      source: 'upload',
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
    return NextResponse.json(
      { ok: false, error: `Création facture d'achat : ${faErr?.message ?? 'inconnue'}` },
      { status: 500 },
    );
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

  return NextResponse.json({
    ok: true,
    facture_achat_id: factureAchatId,
    doublon: Boolean(doublonDeId),
    confiance_min: extraction?.confiance_min ?? null,
    extraction_error: extractionError,
  });
}
