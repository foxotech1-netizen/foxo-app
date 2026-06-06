// src/lib/assistant/tools/foxo-read.ts
//
// Boîte à outils LECTURE SEULE de l'assistant IA admin (Phase 1).
//
// Cloisonnement : ces outils reçoivent TOUJOURS un client Supabase déjà lié au
// demandeur (RLS-bound). Ils ne décident pas eux-mêmes du périmètre : c'est le
// client + les policies RLS qui bornent ce qui est visible. En Phase 1 l'appelant
// est l'admin (client cookie-bound, policies admin = accès complet). Les phases
// suivantes réutiliseront ces mêmes outils avec un client restreint par rôle.
//
// Aucun de ces outils n'écrit, n'envoie ou ne supprime quoi que ce soit.

import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildInterventionContext } from '@/lib/assistant/context';
import { listFolderFiles, resolveInterventionFolderByName } from '@/lib/google-drive';

const STATUTS = ['nouvelle', 'attente', 'confirmee', 'realisee', 'rapport', 'cloturee', 'en_suspens'] as const;
const PRIORITES = ['normale', 'urgente'] as const;

export const FOXO_READ_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_interventions',
    description:
      "Recherche des interventions (dossiers) dans toute la base FoxO, au-delà des dossiers déjà affichés dans le contexte. " +
      "Utilise cet outil dès que la question porte sur un dossier, un syndic, une adresse ou une période absents du contexte fourni. " +
      "Tous les filtres sont optionnels et se combinent (ET logique). Retourne une liste compacte triée du plus récemment mis à jour au plus ancien.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: "Texte recherché dans la référence, l'adresse et la description du dossier." },
        statut: { type: 'string', enum: [...STATUTS], description: 'Filtre sur le statut du dossier.' },
        priorite: { type: 'string', enum: [...PRIORITES], description: 'Filtre sur la priorité.' },
        non_assignee: { type: 'boolean', description: 'Si true, ne retourne que les dossiers sans technicien assigné.' },
        date_min: { type: 'string', description: 'Date ISO (AAAA-MM-JJ). Dossiers dont le créneau commence à partir de cette date.' },
        date_max: { type: 'string', description: 'Date ISO (AAAA-MM-JJ). Dossiers dont le créneau commence avant ou à cette date.' },
        limit: { type: 'integer', description: 'Nombre maximum de résultats (défaut 25, max 100).' },
      },
      required: [],
    },
  },
  {
    name: 'get_intervention_detail',
    description:
      "Renvoie la fiche complète d'un dossier d'intervention à partir de sa référence (ex : 2026-014) : identité, lieu/ACP, syndic, technicien, occupants, emails liés et rapport éventuel. À utiliser quand l'admin demande le détail d'un dossier précis.",
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Référence du dossier (champ ref, ex : 2026-014).' },
      },
      required: ['ref'],
    },
  },
  {
    name: 'get_pipeline_stats',
    description:
      "Renvoie des statistiques agrégées sur l'ENSEMBLE du pipeline (toute la base, pas seulement les dossiers récents) : nombre de dossiers par statut, urgents non clôturés, en retard, en suspens, prévus aujourd'hui. À utiliser pour toute question chiffrée globale sur l'activité.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_intervention_documents',
    description:
      "Liste les documents stockés dans le dossier Google Drive d'une intervention (lecture seule), à partir de sa référence (ex : 2026-014) : rapports, photos, factures et pièces jointes classés dans le dossier. Affiche pour chaque élément son nom, son type, sa date de modification et un lien d'ouverture. À utiliser quand l'admin demande quels fichiers ou documents existent pour un dossier.",
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Référence du dossier (champ ref, ex : 2026-014).' },
      },
      required: ['ref'],
    },
  },
];

export async function executeFoxoReadTool(
  name: string,
  input: unknown,
  supabase: SupabaseClient,
): Promise<string> {
  try {
    const args = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    switch (name) {
      case 'search_interventions':
        return await searchInterventions(args, supabase);
      case 'get_intervention_detail':
        return await getInterventionDetail(args, supabase);
      case 'get_pipeline_stats':
        return await getPipelineStats(supabase);
      case 'list_intervention_documents':
        return await listInterventionDocuments(args, supabase);
      default:
        return `Outil inconnu : ${name}.`;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'erreur inconnue';
    return `Erreur lors de l'exécution de l'outil ${name} : ${msg}`;
  }
}

interface IvRow {
  id: string;
  ref: string | null;
  type: string | null;
  statut: string | null;
  priorite: string | null;
  creneau_debut: string | null;
  adresse: string | null;
  updated_at: string | null;
  acp_id: string | null;
  syndic_id: string | null;
  technicien_id: string | null;
}

function sanitizeQuery(raw: string): string {
  return raw.replace(/[,()*%]/g, ' ').trim();
}

function uniq(ids: (string | null)[]): string[] {
  return Array.from(new Set(ids.filter((x): x is string => typeof x === 'string' && x.length > 0)));
}

async function searchInterventions(args: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const ignored: string[] = [];

  let limit = typeof args.limit === 'number' ? Math.floor(args.limit) : 25;
  if (!Number.isFinite(limit) || limit <= 0) limit = 25;
  if (limit > 100) limit = 100;

  let q = supabase
    .from('interventions')
    .select('id, ref, type, statut, priorite, creneau_debut, adresse, updated_at, acp_id, syndic_id, technicien_id')
    .is('deleted_at', null);

  if (typeof args.query === 'string' && args.query.trim()) {
    const q2 = sanitizeQuery(args.query);
    if (q2) q = q.or(`ref.ilike.%${q2}%,adresse.ilike.%${q2}%,description.ilike.%${q2}%`);
  }
  if (typeof args.statut === 'string') {
    if ((STATUTS as readonly string[]).includes(args.statut)) q = q.eq('statut', args.statut);
    else ignored.push(`statut="${args.statut}"`);
  }
  if (typeof args.priorite === 'string') {
    if ((PRIORITES as readonly string[]).includes(args.priorite)) q = q.eq('priorite', args.priorite);
    else ignored.push(`priorite="${args.priorite}"`);
  }
  if (args.non_assignee === true) q = q.is('technicien_id', null);
  if (typeof args.date_min === 'string' && args.date_min.trim()) q = q.gte('creneau_debut', args.date_min);
  if (typeof args.date_max === 'string' && args.date_max.trim()) q = q.lte('creneau_debut', args.date_max);

  const { data, error } = await q.order('updated_at', { ascending: false }).limit(limit);
  if (error) return `Erreur de recherche : ${error.message}`;
  const rows = (data ?? []) as IvRow[];
  if (rows.length === 0) {
    return `Aucune intervention ne correspond aux critères${ignored.length ? ` (filtres ignorés car invalides : ${ignored.join(', ')})` : ''}.`;
  }

  const acpIds = uniq(rows.map((r) => r.acp_id));
  const synIds = uniq(rows.map((r) => r.syndic_id));
  const techIds = uniq(rows.map((r) => r.technicien_id));

  const [acpData, synData, techData] = await Promise.all([
    acpIds.length ? supabase.from('acps').select('id, nom, ville').in('id', acpIds) : Promise.resolve({ data: [] as unknown[] }),
    synIds.length ? supabase.from('organisations').select('id, nom').in('id', synIds) : Promise.resolve({ data: [] as unknown[] }),
    techIds.length ? supabase.from('utilisateurs').select('id, prenom, nom').in('id', techIds) : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const acpMap = new Map(((acpData.data ?? []) as { id: string; nom: string | null; ville: string | null }[]).map((a) => [a.id, a]));
  const synMap = new Map(((synData.data ?? []) as { id: string; nom: string | null }[]).map((s) => [s.id, s]));
  const techMap = new Map(((techData.data ?? []) as { id: string; prenom: string | null; nom: string | null }[]).map((t) => [t.id, t]));

  const lines = rows.map((r) => {
    const acp = r.acp_id ? acpMap.get(r.acp_id) : null;
    const syn = r.syndic_id ? synMap.get(r.syndic_id) : null;
    const tech = r.technicien_id ? techMap.get(r.technicien_id) : null;
    const creneau = r.creneau_debut ? new Date(r.creneau_debut).toLocaleString('fr-BE') : 'non planifié';
    const techStr = tech ? `${tech.prenom ?? ''} ${tech.nom ?? ''}`.trim() : 'non assigné';
    const lieu = acp?.nom ?? r.adresse ?? '—';
    const ville = acp?.ville ? ` (${acp.ville})` : '';
    return `- ${r.ref ?? '(sans ref)'} · ${r.statut ?? '?'} · ${r.priorite ?? '?'} · ${r.type ?? '—'} · ${lieu}${ville} · syndic : ${syn?.nom ?? '—'} · tech : ${techStr} · créneau : ${creneau}`;
  });

  const header = `${rows.length} intervention(s) trouvée(s)${rows.length === limit ? ` (limite ${limit} atteinte — affine les filtres pour en voir d'autres)` : ''}${ignored.length ? ` — filtres ignorés : ${ignored.join(', ')}` : ''} :`;
  return [header, ...lines].join('\n');
}

async function getInterventionDetail(args: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const ref = typeof args.ref === 'string' ? args.ref.trim() : '';
  if (!ref) return "Paramètre 'ref' manquant.";

  const { data, error } = await supabase
    .from('interventions')
    .select('id')
    .ilike('ref', ref)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  if (error) return `Erreur de recherche du dossier : ${error.message}`;
  const found = data as { id: string } | null;
  if (!found) return `Aucun dossier trouvé pour la référence « ${ref} ».`;

  const ctx = await buildInterventionContext(found.id);
  return ctx ?? `Dossier « ${ref} » introuvable (détail indisponible).`;
}

async function getPipelineStats(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase
    .from('interventions')
    .select('statut, priorite, creneau_debut')
    .is('deleted_at', null)
    .limit(5000);
  if (error) return `Erreur lors du calcul des statistiques : ${error.message}`;
  const rows = (data ?? []) as { statut: string | null; priorite: string | null; creneau_debut: string | null }[];

  const now = Date.now();
  const byStatut = new Map<string, number>();
  let urgentes = 0;
  let enRetard = 0;
  let enSuspens = 0;
  let aujourdhui = 0;
  const todayStr = new Date().toDateString();

  for (const r of rows) {
    const s = r.statut ?? 'inconnu';
    byStatut.set(s, (byStatut.get(s) ?? 0) + 1);
    const estCloturee = s === 'cloturee';
    if (r.priorite === 'urgente' && !estCloturee) urgentes++;
    if (s === 'en_suspens') enSuspens++;
    if (r.creneau_debut) {
      const t = new Date(r.creneau_debut).getTime();
      if (t < now && s !== 'cloturee' && s !== 'rapport') enRetard++;
      if (new Date(r.creneau_debut).toDateString() === todayStr) aujourdhui++;
    }
  }

  const lines: string[] = [];
  lines.push(`Statistiques pipeline FoxO (base complète, ${rows.length} dossier(s) non supprimés) :`);
  lines.push(`- Par statut : ${Array.from(byStatut.entries()).map(([s, n]) => `${s}=${n}`).join(', ') || '—'}`);
  lines.push(`- Urgents non clôturés : ${urgentes}`);
  lines.push(`- En retard (créneau dépassé, non clôturé/rapport) : ${enRetard}`);
  lines.push(`- En suspens : ${enSuspens}`);
  lines.push(`- Prévus aujourd'hui : ${aujourdhui}`);
  if (rows.length === 5000) lines.push('(Note : plafond de 5000 dossiers atteint, chiffres possiblement tronqués.)');
  return lines.join('\n');
}

function fmtBytes(n: number | null): string {
  if (n == null) return '';
  if (n < 1024) return ` · ${n} o`;
  if (n < 1024 * 1024) return ` · ${(n / 1024).toFixed(0)} Ko`;
  return ` · ${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

async function listInterventionDocuments(args: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  const ref = typeof args.ref === 'string' ? args.ref.trim() : '';
  if (!ref) return "Paramètre 'ref' manquant.";

  const { data, error } = await supabase
    .from('interventions')
    .select('id, ref, adresse, drive_folder_id')
    .ilike('ref', ref)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  if (error) return `Erreur de recherche du dossier : ${error.message}`;
  const iv = data as { id: string; ref: string | null; adresse: string | null; drive_folder_id: string | null } | null;
  if (!iv) return `Aucun dossier trouvé pour la référence « ${ref} ».`;
  // L'ID de dossier Drive n'est pas toujours persisté en base : les uploads
  // (rapport, photos) retrouvent le dossier par son NOM. Si l'ID stocké est
  // absent, on résout le dossier de la même façon (lecture seule, sans créer).
  let folderId = iv.drive_folder_id;
  if (!folderId) {
    const yr = Number((iv.ref ?? '').slice(0, 4)) || new Date().getFullYear();
    folderId = await resolveInterventionFolderByName(iv.ref ?? ref, yr);
  }
  if (!folderId) {
    return `Le dossier « ${iv.ref ?? ref} » n'a pas encore de dossier Google Drive associé. Aucun document à lister.`;
  }

  const res = await listFolderFiles(folderId);
  if (!res.ok) return `Impossible de lister les documents du dossier « ${iv.ref ?? ref} » : ${res.error}`;
  if (res.files.length === 0) {
    return `Le dossier Drive de « ${iv.ref ?? ref} » est vide (aucun fichier ni sous-dossier).`;
  }

  const lines = res.files.map((f) => {
    const kind = f.isFolder ? 'dossier' : (f.mimeType || 'fichier');
    const when = f.modifiedTime ? new Date(f.modifiedTime).toLocaleString('fr-BE') : '?';
    const link = f.webViewLink ? ` · ${f.webViewLink}` : '';
    const size = f.isFolder ? '' : fmtBytes(f.size);
    return `- ${f.name} · ${kind} · modifié ${when}${size}${link}`;
  });
  const header = `Documents du dossier « ${iv.ref ?? ref} »${iv.adresse ? ` (${iv.adresse})` : ''} — ${res.files.length} élément(s) :`;
  return [header, ...lines].join('\n');
}
