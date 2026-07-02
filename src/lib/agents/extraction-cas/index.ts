/**
 * src/lib/agents/extraction-cas/index.ts
 *
 * Agent « extraction_cas » (chantier Assistant terrain, étape 3).
 * Transforme UN rapport de recherche de fuite (PDF, texte + photos) en une
 * fiche normalisée « 7 blocs » destinée à la table `cas_terrain`
 * (base de connaissances anonymisée — réf. NOTE_CONCEPTION v0.3 §4).
 *
 * Règles :
 *  - doc 02 §10 : appel Anthropic encapsulé dans runAgent (agent utilitaire).
 *  - RGPD : la fiche produite est ANONYME (aucun nom, adresse, téléphone…).
 *    Les résumés loggés (input/output summary) sont non-PII par construction.
 *  - Ne rien inventer : information absente → null / liste vide + confiance
 *    basse. `a_relire` est calculé côté code, jamais par le modèle.
 *  - Leçon UV : la couleur d'un traceur se lit dans le TEXTE du rapport,
 *    jamais déduite de l'apparence des photos (fluorescence trompeuse).
 */

import Anthropic from '@anthropic-ai/sdk';
import { runAgent } from '@/lib/observability';
import { getValidAccessToken } from '@/lib/google-auth';

export const EXTRACTION_MODEL = 'claude-sonnet-4-6';

/** Seuil de confiance par bloc en dessous duquel la fiche part en relecture. */
const CONF_SEUIL = 0.55;

/** Taille max du PDF accepté (l'API Anthropic plafonne la requête à ~32 Mo). */
const MAX_PDF_BYTES = 30 * 1024 * 1024;

/** Référentiel canonique des techniques (bloc 3). */
export const TECHNIQUES_CANONIQUES = [
  'inspection_visuelle',
  'camera_endoscopique',
  'thermographie',
  'gaz_traceur',
  'liquide_traceur',
  'humidimetre',
  'hygrometre',
  'test_pression_compteur',
  'test_ecoulement_remplissage',
  'detection_acoustique',
  'autre',
] as const;

const STATUTS_FUITE = new Set(['trouvee', 'presumee', 'non_trouvee']);
const QUALITES_SOURCE = new Set(['riche', 'partielle', 'maigre']);
const BLOCS_CONFIANCE = [
  'contexte',
  'symptome',
  'techniques',
  'raisonnement',
  'conclusion',
  'recommandation',
  'preuves_visuelles',
] as const;

export type BlocConfiance = (typeof BLOCS_CONFIANCE)[number];

/** Fiche normalisée telle que stockée dans `cas_terrain` (blocs = jsonb). */
export type FicheCasTerrain = {
  annee: number | null;
  qualite_source: string | null;
  statut_fuite: string | null;
  contexte: Record<string, unknown> | null;
  symptome: Record<string, unknown> | null;
  symptome_resume: string | null;
  techniques: unknown[];
  raisonnement: Record<string, unknown> | null;
  conclusion: Record<string, unknown> | null;
  recommandation: Record<string, unknown> | null;
  preuves_visuelles: unknown[];
  confiance: Record<BlocConfiance, number>;
};

export type ExtractionCasResult = {
  fiche: FicheCasTerrain;
  aRelire: boolean;
  confMin: number;
  logId: string;
  costEurCents: number;
  durationMs: number;
};

// ─── Prompt système ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Tu es un expert en recherche de fuite non destructive (bâtiment, Belgique).
On te donne UN rapport d'intervention (PDF : texte + photos, thermographies, endoscopies).
Ta mission : produire une fiche JSON normalisée pour une base de connaissances qui servira
à guider de futurs techniciens. La fiche doit capturer le RAISONNEMENT de diagnostic, pas
seulement le résultat.

ANONYMISATION ABSOLUE (RGPD) — dans TOUTE la fiche, y compris les textes libres :
- INTERDIT : noms de personnes, de sociétés clientes, de syndics, de gestionnaires ;
  adresses (rue, numéro, commune, code postal) ; e-mails ; téléphones ; références
  de dossier ou de facturation ; toute donnée identifiante.
- AUTORISÉ : tout le contenu technique (type de bien, niveau, matériaux, distances,
  mesures, techniques, causes, recommandations).
- Si une info interdite apparaît dans le rapport, tu la GÉNÉRALISES (ex. « l'occupante »,
  « le syndic », « un immeuble de rapport », « l'appartement du dessus »).

RÈGLES DE FOND :
1. Ne rien inventer. Une information absente du rapport → null (ou liste vide) et
   confiance basse pour le bloc concerné.
2. La couleur d'un liquide traceur se lit dans le TEXTE du rapport uniquement —
   jamais déduite des photos (la fluorescence UV fausse les couleurs).
3. Les blocs « techniques » et « raisonnement » sont les PLUS IMPORTANTS : sois-y
   exhaustif et précis (mesures, distances, matériaux bienvenus — c'est non identifiant).
   Une technique qui n'a « rien révélé » est une information précieuse (exclusion) :
   consigne-la.
4. Réponds en français.

FORMAT DE SORTIE — un UNIQUE objet JSON strict, sans balisage markdown, sans
commentaire, sans texte avant ou après. Schéma exact :

{
  "annee": entier (année de l'intervention, lue dans le rapport) ou null,
  "qualite_source": "riche" | "partielle" | "maigre"
      (riche = déroulé complet des tests et du raisonnement ;
       partielle = résultat détaillé mais raisonnement incomplet ;
       maigre = conclusion quasi seule),
  "statut_fuite": "trouvee" | "presumee" | "non_trouvee",
  "contexte": {
    "type_bien": string ou null (ex. "maison unifamiliale", "immeuble d'appartements",
        "bâtiments mitoyens", "commerce"),
    "niveau": string ou null (ex. "sous-sol/cave", "rez-de-chaussée", "4e étage",
        "toiture", "parties communes"),
    "configuration": [strings] (éléments techniques du bâti pertinents : gaine technique,
        vide technique, faux plafond, conduit encastré, chemisage existant, chambre de
        visite aveugle…),
    "declencheur": string ou null (ce qui provoque ou aggrave : fortes pluies, usage
        baignoire/douche, débit combiné, permanent…)
  },
  "symptome": {
    "localisation": string (où l'eau/le dégât apparaît),
    "aspect": string (goutte-à-goutte, auréoles, écoulement actif, stagnation,
        inondation, perte de pression…),
    "temporalite": string (permanent, lié à la pluie, lié à l'usage, intermittent…),
    "historique": string ou null (épisodes ou interventions antérieurs, diagnostics
        tiers, réparations déjà tentées)
  },
  "symptome_resume": string — 2 à 4 phrases, ANONYMES, décrivant la situation de départ
      comme un technicien la dicterait à un collègue au téléphone (ce champ servira de
      clé de recherche par similarité),
  "techniques": [
    {
      "ordre": entier (1 = première technique employée),
      "technique": une valeur EXACTE de : ${'inspection_visuelle | camera_endoscopique | thermographie | gaz_traceur | liquide_traceur | humidimetre | hygrometre | test_pression_compteur | test_ecoulement_remplissage | detection_acoustique | autre'},
      "detail": string ou null (variante ou mise en œuvre : colorant jaune, obturation +
          remplissage au tuyau d'arrosage, chauffage allumé plusieurs heures avant…),
      "revele": string (ce que CE test a montré — y compris « aucune anomalie », qui
          vaut exclusion)
    }
  ],
  "raisonnement": {
    "hypotheses_envisagees": [strings],
    "hypotheses_ecartees": [ { "hypothese": string, "raison": string } ],
    "test_confirmation": { "description": string, "resultat": string } ou null
        (LE test décisif qui a confirmé ou infirmé la cause),
    "pieges_precautions": [strings] (précautions méthodologiques lisibles dans le
        rapport : traceur dilué donc inutilisable, absence de pluie récente garantissant
        l'origine, tester séparément puis simultanément, interrompre avant d'aggraver…)
  },
  "conclusion": {
    "statut": même valeur que statut_fuite,
    "element_en_cause": string ou null (l'élément précis : mitigeur, cassure de conduit
        à X m, raccord de groupe de sécurité…),
    "mecanisme": string ou null (comment l'eau va de l'origine au point de dégât),
    "certitude": "confirmee_par_test" | "presumee"
  },
  "recommandation": {
    "action": string ou null,
    "corps_metier": string ou null (plombier, société de chemisage, débouchage,
        entreprise spécialisée…),
    "preventif": [strings] (clapet anti-retour, trappe d'accès, surveillance…)
  },
  "preuves_visuelles": [
    { "montre": string, "pourquoi_decisif": string }
  ] (uniquement les quelques photos-clés du diagnostic : zone chaude thermographique,
     fluorescence du traceur, cassure vue à l'endoscopie…),
  "confiance": {
    "contexte": nombre 0..1, "symptome": nombre 0..1, "techniques": nombre 0..1,
    "raisonnement": nombre 0..1, "conclusion": nombre 0..1,
    "recommandation": nombre 0..1, "preuves_visuelles": nombre 0..1
  }
}`;

// ─── Parsing & normalisation ────────────────────────────────────────────────

const STRIP_FENCE_RE = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/;

function parseFicheJson(raw: string): Record<string, unknown> {
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

function asRecordOrNull(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function clamp01(v: unknown): number {
  const n = typeof v === 'number' ? v : Number.NaN;
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Normalise la sortie brute du modèle vers FicheCasTerrain + calcule a_relire. */
export function normaliseFiche(rawFiche: Record<string, unknown>): {
  fiche: FicheCasTerrain;
  aRelire: boolean;
  confMin: number;
} {
  let aRelire = false;

  const anneeRaw = rawFiche.annee;
  const annee =
    typeof anneeRaw === 'number' && Number.isInteger(anneeRaw) && anneeRaw >= 1990 && anneeRaw <= 2100
      ? anneeRaw
      : null;

  const qualite =
    typeof rawFiche.qualite_source === 'string' && QUALITES_SOURCE.has(rawFiche.qualite_source)
      ? rawFiche.qualite_source
      : null;
  if (!qualite) aRelire = true;

  const statut =
    typeof rawFiche.statut_fuite === 'string' && STATUTS_FUITE.has(rawFiche.statut_fuite)
      ? rawFiche.statut_fuite
      : null;
  if (!statut) aRelire = true;

  const symptomeResume =
    typeof rawFiche.symptome_resume === 'string' && rawFiche.symptome_resume.trim().length > 0
      ? rawFiche.symptome_resume.trim()
      : null;
  if (!symptomeResume) aRelire = true;

  const techniques = asArray(rawFiche.techniques);
  if (techniques.length === 0) aRelire = true;

  const confRaw = asRecordOrNull(rawFiche.confiance) ?? {};
  const confiance = {} as Record<BlocConfiance, number>;
  for (const bloc of BLOCS_CONFIANCE) {
    confiance[bloc] = clamp01(confRaw[bloc]);
  }
  const confMin = Math.min(...BLOCS_CONFIANCE.map((b) => confiance[b]));
  if (confMin < CONF_SEUIL) aRelire = true;

  const fiche: FicheCasTerrain = {
    annee,
    qualite_source: qualite,
    statut_fuite: statut,
    contexte: asRecordOrNull(rawFiche.contexte),
    symptome: asRecordOrNull(rawFiche.symptome),
    symptome_resume: symptomeResume,
    techniques,
    raisonnement: asRecordOrNull(rawFiche.raisonnement),
    conclusion: asRecordOrNull(rawFiche.conclusion),
    recommandation: asRecordOrNull(rawFiche.recommandation),
    preuves_visuelles: asArray(rawFiche.preuves_visuelles),
    confiance,
  };

  return { fiche, aRelire, confMin };
}

// ─── Téléchargement Drive (binaire) ────────────────────────────────────────

export type DrivePdfDownload =
  | { ok: true; base64: string; sizeBytes: number }
  | { ok: false; error: string };

/** Télécharge un PDF Drive (alt=media) et le renvoie en base64 standard. */
export async function downloadDrivePdfBase64(fileId: string): Promise<DrivePdfDownload> {
  if (!fileId) return { ok: false, error: 'ID fichier vide.' };
  const auth = await getValidAccessToken();
  if (!auth) return { ok: false, error: 'Google non connecté.' };

  let res: Response;
  try {
    res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${auth.access_token}` } },
    );
  } catch (e) {
    return { ok: false, error: `Échec réseau Drive : ${e instanceof Error ? e.message : 'inconnu'}` };
  }
  if (res.status === 404) return { ok: false, error: `Fichier Drive introuvable (${fileId}).` };
  if (res.status === 403) return { ok: false, error: `Accès refusé au fichier ${fileId}.` };
  if (!res.ok) {
    const txt = await res.text();
    return { ok: false, error: `Drive HTTP ${res.status} : ${txt.slice(0, 200)}` };
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_PDF_BYTES) {
    return { ok: false, error: `PDF trop volumineux (${Math.round(buf.byteLength / 1048576)} Mo > 30 Mo).` };
  }
  return { ok: true, base64: buf.toString('base64'), sizeBytes: buf.byteLength };
}

// ─── Extraction (appel modèle via runAgent) ────────────────────────────────

export async function extractCasTerrain(args: {
  pdfBase64: string;
  /** Identifiant source opaque (ex. file ID Drive) — loggé, jamais de PII. */
  sourceRef: string;
}): Promise<ExtractionCasResult> {
  const { pdfBase64, sourceRef } = args;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquante.');
  const client = new Anthropic({ apiKey });

  const result = await runAgent<{ fiche: FicheCasTerrain; aRelire: boolean; confMin: number }>({
    agentName: 'extraction_cas',
    agentKind: 'utility',
    model: EXTRACTION_MODEL,
    inputSummary: {
      source_ref: sourceRef,
      pdf_kb: Math.round((pdfBase64.length * 3) / 4 / 1024),
    },
    run: async () => {
      const msg = await client.messages.create({
        model: EXTRACTION_MODEL,
        max_tokens: 4096,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
              },
              {
                type: 'text',
                text: 'Analyse ce rapport d\'intervention et produis la fiche JSON conforme au schéma.',
              },
            ],
          },
        ],
      });

      const rawText = msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');

      const { fiche, aRelire, confMin } = normaliseFiche(parseFicheJson(rawText));

      return {
        message: msg,
        output: { fiche, aRelire, confMin },
        outputSummary: {
          statut_fuite: fiche.statut_fuite,
          qualite_source: fiche.qualite_source,
          annee: fiche.annee,
          nb_techniques: fiche.techniques.length,
          conf_min: confMin,
          a_relire: aRelire,
        },
        confidenceScore: confMin,
      };
    },
  });

  return {
    fiche: result.output.fiche,
    aRelire: result.output.aRelire,
    confMin: result.output.confMin,
    logId: result.logId,
    costEurCents: result.costEurCents,
    durationMs: result.durationMs,
  };
}
