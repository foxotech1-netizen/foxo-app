/**
 * src/lib/agents/extraction-cas/ingest-batch.ts
 *
 * Runner d'ingestion batch (chantier « Assistant terrain », étape 4).
 * Un passage = un petit lot : liste le dossier Drive source, repère les PDF
 * pas encore présents dans `cas_terrain` (clé d'idempotence source_ref),
 * en traite BATCH_SIZE au plus, puis rend la main. Rejouable à l'infini :
 * l'état d'avancement EST la base (aucun curseur à maintenir).
 *
 * Tolérance aux pannes : un PDF qui échoue est consigné dans
 * `cas_terrain_echecs` (tentatives++) et retenté aux passages suivants ;
 * au-delà de MAX_TENTATIVES il est écarté définitivement de la sélection
 * (liste consultable en SQL pour arbitrage humain en fin de chantier).
 * Un échec n'interrompt jamais le lot en cours.
 *
 * Garde temporelle : la route appelante vit sous maxDuration = 300 s ;
 * on ne DÉMARRE pas de nouveau fichier au-delà de TIME_BUDGET_MS afin que
 * le fichier en cours ait toujours la place de finir.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { listFolderFilesDeep } from '@/lib/google-drive';
import {
  downloadDrivePdfBase64,
  extractCasTerrain,
  EXTRACTION_MODEL,
} from './index';

/** Fichiers traités par passage (~50 s d'extraction chacun). */
const BATCH_SIZE = 3;
/** On ne démarre pas de nouveau fichier au-delà de ce temps écoulé. */
const TIME_BUDGET_MS = 210_000;
/** Au-delà : le fichier est écarté de la sélection (arbitrage humain). */
const MAX_TENTATIVES = 3;
/** Plafond de listing Drive (le fonds visé ≈ 2000 fichiers). */
const MAX_LISTING_FILES = 5000;

export type IngestBatchResult = {
  /** Fiches extraites et écrites pendant CE passage. */
  processed: number;
  /** Échecs pendant CE passage (consignés dans cas_terrain_echecs). */
  failed: number;
  /** Candidats restant à traiter APRÈS ce passage (hors écartés). */
  remaining: number;
  /** PDF écartés définitivement (tentatives >= MAX_TENTATIVES). */
  setAside: number;
  /** Total de PDF dans le périmètre (après filtre d'années éventuel). */
  totalPdf: number;
  /** Coût cumulé de CE passage, en centimes d'euro. */
  costEurCents: number;
  /** Détail par fichier traité pendant ce passage. */
  details: Array<{ source_ref: string; ok: boolean; error?: string }>;
};

/**
 * Lit TOUTES les valeurs d'une colonne texte d'une table, en paginant par
 * 1000 (le client Supabase plafonne chaque select à 1000 lignes — sans
 * cette boucle, l'idempotence casserait silencieusement passé 1000 fiches).
 */
async function fetchAllColumn(
  admin: ReturnType<typeof createAdminClient>,
  table: string,
  column: string,
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from(table)
      .select('*')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Lecture ${table} : ${error.message}`);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    for (const r of rows) {
      const key = r[column];
      if (typeof key === 'string') out.set(key, r);
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function runIngestBatch(
  folderId: string,
  opts?: { allowedYears?: string[] },
): Promise<IngestBatchResult> {
  const admin = createAdminClient();
  const startedAt = Date.now();

  // 1) Inventaire Drive (récursif, sous-dossiers année/mois inclus).
  const listing = await listFolderFilesDeep(folderId, { maxFiles: MAX_LISTING_FILES });
  if (!listing.ok) throw new Error(`Listing Drive échoué : ${listing.error}`);
  const allPdfs = listing.files.filter((f) => f.mimeType === 'application/pdf');

  // Filtre d'années (pilote) : par convention de nommage du fonds, le nom
  // d'un rapport COMMENCE par son année (« 2023-045 … »). Liste vide ou
  // absente = aucun filtre. Un PDF hors périmètre n'est ni traité ni compté.
  const years = (opts?.allowedYears ?? []).map((y) => y.trim()).filter(Boolean);
  const pdfs =
    years.length === 0
      ? allPdfs
      : allPdfs.filter((f) => years.some((y) => f.name.trim().startsWith(y)));

  // 2) État d'avancement : fiches déjà en base + échecs consignés.
  const done = await fetchAllColumn(admin, 'cas_terrain', 'source_ref');
  const echecs = await fetchAllColumn(admin, 'cas_terrain_echecs', 'source_ref');

  const tentativesOf = (id: string): number => {
    const row = echecs.get(id);
    const t = row?.tentatives;
    return typeof t === 'number' ? t : 0;
  };

  const candidates = pdfs.filter(
    (f) => !done.has(f.id) && tentativesOf(f.id) < MAX_TENTATIVES,
  );
  const setAside = pdfs.filter(
    (f) => !done.has(f.id) && tentativesOf(f.id) >= MAX_TENTATIVES,
  ).length;

  // 3) Traitement du lot — mélange de Fisher-Yates d'abord : chaque passage
  // pioche AU HASARD dans le périmètre, donc les fiches du pilote mixent
  // naturellement les années au lieu de vider les dossiers dans l'ordre.
  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = candidates[i];
    const b = candidates[j];
    if (a && b) {
      candidates[i] = b;
      candidates[j] = a;
    }
  }
  const batch = candidates.slice(0, BATCH_SIZE);
  const details: IngestBatchResult['details'] = [];
  let processed = 0;
  let failed = 0;
  let costEurCents = 0;

  for (const file of batch) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    try {
      const dl = await downloadDrivePdfBase64(file.id);
      if (!dl.ok) throw new Error(dl.error);

      const extraction = await extractCasTerrain({
        pdfBase64: dl.base64,
        sourceRef: file.id,
      });

      // Upsert idempotent — mêmes colonnes que la route extract-test.
      const { error } = await admin.from('cas_terrain').upsert(
        {
          source_ref: file.id,
          annee: extraction.fiche.annee,
          qualite_source: extraction.fiche.qualite_source,
          statut_fuite: extraction.fiche.statut_fuite,
          contexte: extraction.fiche.contexte,
          symptome: extraction.fiche.symptome,
          symptome_resume: extraction.fiche.symptome_resume,
          techniques: extraction.fiche.techniques,
          raisonnement: extraction.fiche.raisonnement,
          conclusion: extraction.fiche.conclusion,
          recommandation: extraction.fiche.recommandation,
          preuves_visuelles: extraction.fiche.preuves_visuelles,
          confiance: extraction.fiche.confiance,
          extrait_par: EXTRACTION_MODEL,
          a_relire: extraction.aRelire,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'source_ref' },
      );
      if (error) throw new Error(`Upsert cas_terrain : ${error.message}`);

      // Succès après échec(s) antérieur(s) : on solde la ligne d'échec.
      if (echecs.has(file.id)) {
        await admin.from('cas_terrain_echecs').delete().eq('source_ref', file.id);
      }

      processed += 1;
      costEurCents += extraction.costEurCents;
      details.push({ source_ref: file.id, ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failed += 1;
      // Best-effort : si CET upsert échoue aussi, on ne masque pas l'échec
      // d'origine — le fichier sera simplement retenté au prochain passage.
      await admin.from('cas_terrain_echecs').upsert(
        {
          source_ref: file.id,
          erreur: msg.slice(0, 500),
          tentatives: tentativesOf(file.id) + 1,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'source_ref' },
      );
      details.push({ source_ref: file.id, ok: false, error: msg.slice(0, 200) });
    }
  }

  return {
    processed,
    failed,
    remaining: candidates.length - processed,
    setAside,
    totalPdf: pdfs.length,
    costEurCents,
    details,
  };
}
