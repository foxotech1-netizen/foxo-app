/**
 * src/lib/agents/extraction-achat/index.ts
 *
 * Agent « extraction_achat » (chantier Facturation v2, bloc D — achats).
 * Transforme UN document fournisseur (PDF ou photo/scan) en données
 * structurées pour pré-remplir `factures_achat`.
 *
 * Règles :
 *  - doc 02 §10 : appel Anthropic encapsulé dans runAgent (agent utilitaire).
 *  - Ne RIEN inventer : champ absent du document → null + confiance basse.
 *  - Montants en nombres décimaux (point), dates ISO (YYYY-MM-DD), TVA belge
 *    normalisée BE0XXXXXXXXX.
 *  - Si le document n'est manifestement pas une facture → type_detecte 'autre'.
 *  - confiance_min est calculée côté code (min des confiances des champs
 *    critiques), jamais par le modèle.
 */

import Anthropic from '@anthropic-ai/sdk';
import { runAgent } from '@/lib/observability';

export const EXTRACTION_ACHAT_MODEL = 'claude-sonnet-4-6';

/** Taille max du document accepté (l'API Anthropic plafonne à ~32 Mo). */
export const MAX_ACHAT_BYTES = 30 * 1024 * 1024;

const TYPES_DETECTES = new Set(['facture_achat', 'ticket', 'autre']);
const IMAGE_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** Champs dont la confiance pèse dans confiance_min (les montants et
 *  l'identité fournisseur sont critiques ; les lignes de détail non). */
const CHAMPS_CRITIQUES = [
  'fournisseur_nom',
  'numero_piece',
  'date_facture',
  'montant_ttc',
] as const;

export interface LigneAchat {
  description: string;
  quantite: number | null;
  prix_unitaire: number | null;
  montant: number | null;
}

export interface ExtractionAchat {
  type_detecte: 'facture_achat' | 'ticket' | 'autre';
  fournisseur_nom: string | null;
  fournisseur_tva: string | null;   // BE0XXXXXXXXX normalisé
  numero_piece: string | null;
  date_facture: string | null;      // YYYY-MM-DD
  date_echeance: string | null;     // YYYY-MM-DD
  montant_ht: number | null;
  montant_tva: number | null;
  montant_ttc: number | null;
  taux_tva: number | null;
  devise: string;                   // 'EUR' par défaut
  lignes: LigneAchat[];
  categorie_suggeree: string | null;
  moyen_paiement: string | null;
  confiances: Record<string, number>;
  confiance_min: number;
}

export type ExtractionAchatResult = {
  extraction: ExtractionAchat;
  logId: string;
  costEurCents: number;
  durationMs: number;
};

// ─── Prompt système ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Tu es un assistant comptable expert en factures fournisseurs belges.
On te donne UN document (PDF ou photo) supposé être une facture d'achat reçue par la
société Fox Group SRL (recherche de fuites, Belgique).

RÈGLES ABSOLUES :
1. Ne RIEN inventer. Une information absente ou illisible → null, et confiance basse
   (< 0.4) pour ce champ. Ne déduis jamais un montant par calcul si le document ne
   l'affiche pas explicitement (exception : si HT et TVA sont affichés mais pas le TTC,
   tu peux les additionner en le signalant par une confiance ≤ 0.7).
2. Montants : nombres décimaux avec POINT décimal, sans séparateur de milliers ni
   symbole (1234.56). Les montants d'une facture d'achat sont POSITIFS.
3. Dates : format ISO YYYY-MM-DD strict.
4. N° TVA belge : normalisé BE0XXXXXXXXX ou BE1XXXXXXXXX (retire points et espaces).
   TVA étrangère : garde le préfixe pays, retire les séparateurs.
5. fournisseur_nom = l'ÉMETTEUR du document (pas Fox Group, qui est le client).
6. Si le document n'est manifestement PAS une facture ou un ticket d'achat
   (rapport, contrat, publicité, photo hors sujet…) → type_detecte "autre",
   tous les champs à null, confiances à 0.
7. Un ticket de caisse simple (sans n° de pièce ni TVA détaillée) → type_detecte
   "ticket" ; une vraie facture → "facture_achat".
8. categorie_suggeree : catégorie de charge courte en français (ex. "Carburant",
   "Matériel & outillage", "Fournitures de bureau", "Sous-traitance", "Télécom",
   "Assurances", "Véhicule", "Logiciels & abonnements") — null si incertain.
9. moyen_paiement : uniquement s'il est lisible sur le document (ex. "Bancontact",
   "domiciliation", "virement", "espèces") — null sinon.
10. Réponds en français.

FORMAT DE SORTIE — un UNIQUE objet JSON strict, sans balisage markdown, sans texte
avant ou après. Schéma exact :

{
  "type_detecte": "facture_achat" | "ticket" | "autre",
  "fournisseur_nom": string | null,
  "fournisseur_tva": string | null,
  "numero_piece": string | null,
  "date_facture": "YYYY-MM-DD" | null,
  "date_echeance": "YYYY-MM-DD" | null,
  "montant_ht": number | null,
  "montant_tva": number | null,
  "montant_ttc": number | null,
  "taux_tva": number | null,
  "devise": string ("EUR" sauf mention contraire),
  "lignes": [
    { "description": string, "quantite": number | null,
      "prix_unitaire": number | null, "montant": number | null }
  ],
  "categorie_suggeree": string | null,
  "moyen_paiement": string | null,
  "confiances": {
    "fournisseur_nom": 0..1, "fournisseur_tva": 0..1, "numero_piece": 0..1,
    "date_facture": 0..1, "date_echeance": 0..1, "montant_ht": 0..1,
    "montant_tva": 0..1, "montant_ttc": 0..1, "taux_tva": 0..1,
    "lignes": 0..1, "categorie_suggeree": 0..1, "moyen_paiement": 0..1
  }
}`;

// ─── Parsing & normalisation ────────────────────────────────────────────────

const STRIP_FENCE_RE = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/;

function parseJsonStrict(raw: string): Record<string, unknown> {
  const fenced = raw.match(STRIP_FENCE_RE);
  const candidate = (fenced ? fenced[1] : raw).trim();
  try {
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('la racine n\'est pas un objet');
    }
    return parsed as Record<string, unknown>;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Convention agent-logger : préfixe explicite + aperçu ≤ 200 caractères.
    throw new Error(`JSON parse: ${msg} (preview: ${candidate.slice(0, 200)})`);
  }
}

function clamp01(v: unknown): number {
  const n = typeof v === 'number' ? v : Number.NaN;
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function asStringOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function asNumberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function asIsoDateOrNull(v: unknown): string | null {
  const s = asStringOrNull(v);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Normalise un n° TVA : retire points/espaces/tirets, majuscules. */
export function normalizeTva(v: unknown): string | null {
  const s = asStringOrNull(v);
  if (!s) return null;
  const cleaned = s.replace(/[.\s-]/g, '').toUpperCase();
  return cleaned.length >= 4 ? cleaned : null;
}

/** Normalise la sortie brute du modèle + calcule confiance_min côté code. */
export function normaliseExtractionAchat(raw: Record<string, unknown>): ExtractionAchat {
  const typeDetecte = typeof raw.type_detecte === 'string' && TYPES_DETECTES.has(raw.type_detecte)
    ? (raw.type_detecte as ExtractionAchat['type_detecte'])
    : 'autre';

  const confRaw = (raw.confiances && typeof raw.confiances === 'object' && !Array.isArray(raw.confiances))
    ? (raw.confiances as Record<string, unknown>)
    : {};
  const confiances: Record<string, number> = {};
  for (const [k, v] of Object.entries(confRaw)) confiances[k] = clamp01(v);

  const lignesRaw = Array.isArray(raw.lignes) ? raw.lignes : [];
  const lignes: LigneAchat[] = lignesRaw
    .filter((l): l is Record<string, unknown> => Boolean(l) && typeof l === 'object' && !Array.isArray(l))
    .map((l) => ({
      description: asStringOrNull(l.description) ?? '',
      quantite: asNumberOrNull(l.quantite),
      prix_unitaire: asNumberOrNull(l.prix_unitaire),
      montant: asNumberOrNull(l.montant),
    }))
    .filter((l) => l.description.length > 0);

  const confianceMin = typeDetecte === 'autre'
    ? 0
    : Math.min(...CHAMPS_CRITIQUES.map((c) => clamp01(confiances[c])));

  return {
    type_detecte: typeDetecte,
    fournisseur_nom: asStringOrNull(raw.fournisseur_nom),
    fournisseur_tva: normalizeTva(raw.fournisseur_tva),
    numero_piece: asStringOrNull(raw.numero_piece),
    date_facture: asIsoDateOrNull(raw.date_facture),
    date_echeance: asIsoDateOrNull(raw.date_echeance),
    montant_ht: asNumberOrNull(raw.montant_ht),
    montant_tva: asNumberOrNull(raw.montant_tva),
    montant_ttc: asNumberOrNull(raw.montant_ttc),
    taux_tva: asNumberOrNull(raw.taux_tva),
    devise: asStringOrNull(raw.devise)?.toUpperCase() ?? 'EUR',
    lignes,
    categorie_suggeree: asStringOrNull(raw.categorie_suggeree),
    moyen_paiement: asStringOrNull(raw.moyen_paiement),
    confiances,
    confiance_min: confianceMin,
  };
}

// ─── Extraction (appel modèle via runAgent) ────────────────────────────────

export async function extractAchat(args: {
  /** PDF en base64 (bloc document natif) — exclusif avec image*. */
  pdfBase64?: string;
  /** Image en base64 (bloc image) — exclusif avec pdfBase64. */
  imageBase64?: string;
  imageMediaType?: string;
  /** Identifiant source opaque (ex. id pieces_capturees) — loggé, jamais de PII. */
  sourceRef: string;
}): Promise<ExtractionAchatResult> {
  const { pdfBase64, imageBase64, imageMediaType, sourceRef } = args;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquante.');
  if (!pdfBase64 && !imageBase64) throw new Error('Aucun document fourni (pdfBase64 ou imageBase64 requis).');

  const documentBlock = pdfBase64
    ? {
        type: 'document' as const,
        source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: pdfBase64 },
      }
    : {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: (IMAGE_MEDIA_TYPES.has(imageMediaType ?? '')
            ? imageMediaType
            : 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
          data: imageBase64!,
        },
      };

  const client = new Anthropic({ apiKey });
  const base64Len = (pdfBase64 ?? imageBase64 ?? '').length;

  const result = await runAgent<ExtractionAchat>({
    agentName: 'extraction_achat',
    agentKind: 'utility',
    model: EXTRACTION_ACHAT_MODEL,
    inputSummary: {
      source_ref: sourceRef,
      kind: pdfBase64 ? 'pdf' : 'image',
      doc_kb: Math.round((base64Len * 3) / 4 / 1024),
    },
    run: async () => {
      const msg = await client.messages.create({
        model: EXTRACTION_ACHAT_MODEL,
        max_tokens: 3000,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              documentBlock,
              {
                type: 'text',
                text: 'Extrais les champs structurés de cette facture fournisseur selon le schéma.',
              },
            ],
          },
        ],
      });

      const rawText = msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');

      const extraction = normaliseExtractionAchat(parseJsonStrict(rawText));

      return {
        message: msg,
        output: extraction,
        outputSummary: {
          type_detecte: extraction.type_detecte,
          has_fournisseur: Boolean(extraction.fournisseur_nom),
          has_tva: Boolean(extraction.fournisseur_tva),
          has_ttc: extraction.montant_ttc != null,
          nb_lignes: extraction.lignes.length,
          conf_min: extraction.confiance_min,
        },
        confidenceScore: extraction.confiance_min,
      };
    },
  });

  return {
    extraction: result.output,
    logId: result.logId,
    costEurCents: result.costEurCents,
    durationMs: result.durationMs,
  };
}
