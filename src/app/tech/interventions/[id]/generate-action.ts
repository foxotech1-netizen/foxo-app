'use server';

import { fmtTime, TZ_BRUSSELS } from '@/lib/format';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { canAccessTechSpace } from "@/lib/auth/server";
import { getFoxoRapportV2Prompt } from '@/lib/prompts/rapport';
import type { Acp, Intervention, Occupant, Organisation, Utilisateur } from '@/lib/types/database';
import { runAgent } from '@/lib/observability';
import { analysePhoto, type PhotoAnalyse } from '@/lib/rapport/analyse-photo';
import { techniquesLabelsToKeys } from '@/lib/rapport/techniques';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 16000; // marge large pour le texte des sections + la liste de toutes les photos (dossiers à nombreuses photos) — évite le JSON tronqué/non parsable

export type GenerateResult =
  | {
      ok: true;
      sections: { degats: string; inspection: string; conclusion: string; recommandations: string };
      // Clés canoniques (cf. techniques.ts), persistées par saveRapport/publishRapport.
      techniques_utilisees: string[];
      techniques_a_confirmer: string[];
      // Photos dont l'analyse vision (passe 1) a échoué — le rapport est
      // généré sans elles (best-effort). Sert à l'avertissement UI (F3/I4).
      photosNonAnalysees?: number;
    }
  | { ok: false; error: string };

type PhotoRow = {
  id: string;
  drive_file_id: string | null;
  filename: string | null;
  section: string | null;
  label: string | null;
  observation_id: string | null;
  analyse_ia: PhotoAnalyse | null;
};

async function assertTechOwner(interventionId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await canAccessTechSpace(user.id))) return { ok: false, error: 'Accès refusé.' };

  const { data: u } = await supabase
    .from('utilisateurs')
    .select('id')
    .eq('email', (user.email ?? '').toLowerCase())
    .maybeSingle();
  if (!u) return { ok: false, error: 'Utilisateur tech non encodé.' };

  const { data: iv } = await supabase
    .from('interventions')
    .select('id, technicien_id')
    .eq('id', interventionId)
    .maybeSingle();
  if (!iv || iv.technicien_id !== u.id) {
    return { ok: false, error: 'Cette intervention ne t\'est pas assignée.' };
  }
  return { ok: true };
}

function buildContextSummary(args: {
  iv: Pick<Intervention, 'ref' | 'type' | 'description' | 'priorite' | 'creneau_debut' | 'adresse' | 'started_at' | 'ended_at'>;
  acp: Pick<Acp, 'nom' | 'adresse' | 'code_postal' | 'ville' | 'bce'> | null;
  syndic: Pick<Organisation, 'nom' | 'type' | 'email' | 'telephone' | 'bce'> | null;
  tech: Pick<Utilisateur, 'prenom' | 'nom'> | null;
  occupants: Occupant[];
  observations?: Array<{
    test_type: string;
    etage: string | null;
    localisation: string | null;
    notes: string | null;
    created_at: string;
  }>;
}): string {
  const { iv, acp, syndic, tech, occupants, observations } = args;
  const lines: string[] = [];

  lines.push(`Référence FoxO : ${iv.ref ?? 'À attribuer'}`);
  lines.push(`Type d'intervention : ${iv.type ?? 'non précisé'}`);
  lines.push(`Priorité : ${iv.priorite}`);
  if (iv.creneau_debut) {
    const d = new Date(iv.creneau_debut);
    lines.push(`Date d'intervention : ${d.toLocaleString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ_BRUSSELS })}`);
  }
  if (iv.started_at && iv.ended_at) {
    const a = new Date(iv.started_at);
    const b = new Date(iv.ended_at);
    const min = Math.round((b.getTime() - a.getTime()) / 60000);
    lines.push(`Durée sur place : ${min} min (${fmtTime(a.toISOString())} → ${fmtTime(b.toISOString())})`);
  }

  if (acp) {
    const adresse = [acp.adresse, acp.code_postal, acp.ville].filter(Boolean).join(', ');
    lines.push(`ACP / Lieu : ${acp.nom} — ${adresse || '—'}`);
    if (acp.bce) lines.push(`BCE de l'ACP : ${acp.bce}`);
  } else if (iv.adresse) {
    lines.push(`Adresse d'intervention : ${iv.adresse}`);
  }

  if (syndic) {
    const role = syndic.type === 'courtier' ? 'Courtier' : 'Syndic';
    lines.push(`${role} : ${syndic.nom}${syndic.email ? ' — ' + syndic.email : ''}${syndic.telephone ? ' — ' + syndic.telephone : ''}`);
    if (syndic.bce) lines.push(`BCE ${role.toLowerCase()} : ${syndic.bce}`);
  }

  if (tech) {
    lines.push(`Technicien intervenant : ${[tech.prenom, tech.nom].filter(Boolean).join(' ')}`);
  }

  if (iv.description) {
    lines.push(`Description initiale du problème (déclarée par le demandeur) : ${iv.description}`);
  }

  if (occupants.length > 0) {
    lines.push(`Occupants concernés (${occupants.length}) :`);
    for (const o of occupants) {
      const label = `Apt. ${o.appartement ?? '—'} — ${o.nom ?? '—'}`;
      const conf = o.conf ? ` (statut : ${o.conf})` : '';
      lines.push(`  · ${label}${conf}`);
    }
  }

  if (observations && observations.length > 0) {
    lines.push(`\nObservations terrain (${observations.length} test(s) enregistrés) :`);
    for (const o of observations) {
      const loc = [o.etage ? `Étage ${o.etage}` : null, o.localisation].filter(Boolean).join(' — ');
      lines.push(`  · ${o.test_type}${loc ? ' — ' + loc : ''}${o.notes ? ' : ' + o.notes : ''}`);
    }
  }

  return lines.join('\n');
}

const STRIP_FENCE_RE = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/;

function tryParseJson(raw: string): { degats?: string; inspection?: string; conclusion?: string; recommandations?: string } | null {
  // Cas où Claude renvoie du markdown ```json ... ```
  const fenced = raw.match(STRIP_FENCE_RE);
  const candidate = fenced ? fenced[1] : raw;
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch { /* try next strategy */ }

  // Recherche d'un bloc JSON dans la réponse
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch { /* give up */ }
  }
  return null;
}

export async function generateRapportSections(
  interventionId: string,
  brief: string,
): Promise<GenerateResult> {
  const own = await assertTechOwner(interventionId);
  if (!own.ok) return { ok: false, error: own.error };

  const trimmed = (brief ?? '').trim();
  if (trimmed.length < 20) {
    return { ok: false, error: 'Le brief est trop court (minimum 20 caractères).' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: 'ANTHROPIC_API_KEY non configurée côté serveur.' };

  // Charge le contexte de l'intervention
  const supabase = await createClient();
  const { data: ivData } = await supabase
    .from('interventions')
    .select('ref, type, description, priorite, creneau_debut, adresse, started_at, ended_at, acp_id, syndic_id, technicien_id')
    .eq('id', interventionId)
    .maybeSingle();
  if (!ivData) return { ok: false, error: 'Intervention introuvable.' };

  const iv = ivData as Pick<Intervention,
    'ref' | 'type' | 'description' | 'priorite' | 'creneau_debut' | 'adresse' |
    'started_at' | 'ended_at' | 'acp_id' | 'syndic_id' | 'technicien_id'>;

  const [acpRes, orgRes, techRes, occRes] = await Promise.all([
    iv.acp_id
      ? supabase.from('acps').select('nom, adresse, code_postal, ville, bce').eq('id', iv.acp_id).maybeSingle()
      : Promise.resolve({ data: null }),
    iv.syndic_id
      ? supabase.from('organisations').select('nom, type, email, telephone, bce').eq('id', iv.syndic_id).maybeSingle()
      : Promise.resolve({ data: null }),
    iv.technicien_id
      ? supabase.from('utilisateurs').select('prenom, nom').eq('id', iv.technicien_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('occupants').select('*').eq('intervention_id', interventionId),
  ]);

  const obsRes = await supabase
    .from('observations_terrain')
    .select('id, test_type, etage, localisation, notes, created_at')
    .eq('intervention_id', interventionId)
    .order('created_at', { ascending: true });
  const observations = (obsRes.data ?? []) as Array<{
    id: string;
    test_type: string;
    etage: string | null;
    localisation: string | null;
    notes: string | null;
    created_at: string;
  }>;
  const obsTestTypeById = new Map(observations.map((o) => [o.id, o.test_type]));

  const ctx = buildContextSummary({
    iv,
    acp: acpRes.data as Pick<Acp, 'nom' | 'adresse' | 'code_postal' | 'ville' | 'bce'> | null,
    syndic: orgRes.data as Pick<Organisation, 'nom' | 'type' | 'email' | 'telephone' | 'bce'> | null,
    tech: techRes.data as Pick<Utilisateur, 'prenom' | 'nom'> | null,
    occupants: (occRes.data ?? []) as Occupant[],
    observations,
  });

  // ── PASSE 1 : analyse vision des photos non encore analysées ──
  const objet = (iv.description ?? '').trim().slice(0, 300) || iv.type || '';
  const { data: photosData } = await supabase
    .from('photos_interventions')
    .select('id, drive_file_id, filename, section, label, observation_id, analyse_ia')
    .eq('intervention_id', interventionId)
    .order('ordre', { ascending: true });
  const photos = (photosData ?? []) as PhotoRow[];

  // Analyse en parallèle UNIQUEMENT les photos dont analyse_ia est null
  // (jamais de ré-analyse). Best-effort : un échec n'interrompt pas la
  // génération, mais il est compté et remonté au tech (audit F3/I4).
  const toAnalyse = photos.filter((p) => !p.analyse_ia && p.drive_file_id);
  let photosNonAnalysees = 0;
  if (toAnalyse.length > 0) {
    const results = await Promise.allSettled(
      toAnalyse.map((p) => analysePhoto({
        interventionId,
        objet,
        photo: {
          id: p.id,
          drive_file_id: p.drive_file_id,
          filename: p.filename,
          section: p.section,
          label: p.label,
          observation_test_type: p.observation_id ? (obsTestTypeById.get(p.observation_id) ?? null) : null,
        },
      })),
    );
    const rejets: Array<{ photo_id: string; reason: unknown }> = [];
    results.forEach((r, idx) => {
      if (r.status === 'fulfilled' && r.value) toAnalyse[idx].analyse_ia = r.value;
      else if (r.status === 'rejected') rejets.push({ photo_id: toAnalyse[idx].id, reason: r.reason });
    });
    // analysePhoto retourne null sur ses échecs internes (download, JSON…) :
    // une photo non analysée = rejet OU fulfilled-null.
    photosNonAnalysees = toAnalyse.filter((p) => !p.analyse_ia).length;
    if (photosNonAnalysees > 0) {
      console.warn(
        `[rapport-v2] ${photosNonAnalysees}/${toAnalyse.length} photos non analysées`,
        rejets.length > 0 ? rejets : '(échecs internes analysePhoto — détail dans les logs [analyse_photo])',
      );
    }
  }

  // Tableau des photos sérialisé pour la passe 2.
  const photosForPrompt = photos.map((p) => ({
    id: p.id, section: p.section, label: p.label, analyse_ia: p.analyse_ia,
  }));

  // ── PASSE 2 : agent rapport v2 ──
  const userMessage = [
    `Génère le rapport pour cette intervention FoxO (corps + techniques + classement des photos).`,
    ``,
    `## CONTEXTE DOSSIER`,
    ctx,
    ``,
    `## DICTÉE DU TECHNICIEN`,
    trimmed,
    ``,
    `## PHOTOS (analyse IA — JSON)`,
    photosForPrompt.length > 0 ? JSON.stringify(photosForPrompt, null, 2) : 'Aucune photo.',
    ``,
    `## RAPPEL DE SORTIE`,
    `- JSON pur, clés : degats, inspection, conclusion, recommandations, techniques_utilisees, techniques_a_confirmer, photos[].`,
    `- N'invente aucune donnée administrative non dictée. Prose française, sans liste ni numérotation.`,
  ].join('\n');

  type RapportV2 = {
    degats?: string; inspection?: string; conclusion?: string; recommandations?: string;
    techniques_utilisees?: unknown; techniques_a_confirmer?: unknown;
    photos?: Array<{ id?: unknown; section?: unknown; legende?: unknown; ordre?: unknown; apres_paragraphe?: unknown }>;
  };
  let parsed: RapportV2;
  try {
    const result = await runAgent<RapportV2>({
      agentName: 'rapport',
      model: MODEL,
      interventionId,
      emailId: null,
      inputSummary: {
        ref_foxo: iv.ref ?? null,
        intervention_type: iv.type ?? null,
        priorite: iv.priorite ?? null,
        brief_length: trimmed.length,
        observations_count: observations.length,
        occupants_count: (occRes.data ?? []).length,
        photos_count: photos.length,
        photos_analyzed: photos.filter((p) => p.analyse_ia).length,
        has_acp: Boolean(acpRes.data),
        has_syndic: Boolean(orgRes.data),
      },
      run: async () => {
        const client = new Anthropic({ apiKey });
        let parsedOut: RapportV2 | null = null;
        let lastMsg: Anthropic.Message | null = null;
        for (let attempt = 0; attempt < 2 && !parsedOut; attempt++) {
          const msg = await client.messages.create({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            system: getFoxoRapportV2Prompt(),
            messages: [{ role: 'user', content: userMessage }],
          });
          lastMsg = msg;
          const block = msg.content[0];
          const rawText = block && block.type === 'text' ? block.text : '';
          const pj = tryParseJson(rawText) as RapportV2 | null;
          if (pj) parsedOut = pj;
          else console.warn(`[tech/generateRapport] JSON invalide (tentative ${attempt + 1})`);
        }
        if (!parsedOut) throw new Error('JSON parse: reponse non parsable');
        const pp = parsedOut;
        const lengths = {
          degats: typeof pp.degats === 'string' ? pp.degats.trim().length : 0,
          inspection: typeof pp.inspection === 'string' ? pp.inspection.trim().length : 0,
          conclusion: typeof pp.conclusion === 'string' ? pp.conclusion.trim().length : 0,
          recommandations: typeof pp.recommandations === 'string' ? pp.recommandations.trim().length : 0,
        };
        return {
          message: lastMsg ?? ({ usage: { input_tokens: 0, output_tokens: 0 } } as Anthropic.Message),
          output: pp,
          outputSummary: {
            has_degats: lengths.degats > 0,
            has_inspection: lengths.inspection > 0,
            has_conclusion: lengths.conclusion > 0,
            has_recommandations: lengths.recommandations > 0,
            sections_count: (Object.values(lengths) as number[]).filter((n) => n > 0).length,
            techniques_count: Array.isArray(pp.techniques_utilisees) ? pp.techniques_utilisees.length : 0,
            photos_classified: Array.isArray(pp.photos) ? pp.photos.length : 0,
            photos_analysis_failed: photosNonAnalysees,
            photos_analysis_failed_ratio: `${photosNonAnalysees}/${toAnalyse.length}`,
          },
        };
      },
    });
    parsed = result.output;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Erreur inconnue';
    if (errMsg.startsWith('JSON parse:')) {
      return { ok: false, error: 'Réponse Claude non parsable. Réessaie ou ajuste la dictée.' };
    }
    console.warn('[tech/generateRapport] Anthropic error:', err);
    return { ok: false, error: 'Anthropic : ' + errMsg };
  }

  // ── Validation applicative ──
  const asLabels = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const techKeysUtil = techniquesLabelsToKeys(asLabels(parsed.techniques_utilisees));
  const utilSet = new Set(techKeysUtil);
  const techKeysConfirm = techniquesLabelsToKeys(asLabels(parsed.techniques_a_confirmer)).filter((k) => !utilSet.has(k));

  // ── Persistance des photos (section/ordre/ancrage_para/label) — guard statut ──
  const photoIds = new Set(photos.map((p) => p.id));
  const labelById = new Map(photos.map((p) => [p.id, p.label]));
  const validSections = new Set(['degats', 'inspection']);
  const photoUpdates = Array.isArray(parsed.photos)
    ? parsed.photos
        .filter((ph) => typeof ph.id === 'string' && photoIds.has(ph.id as string))
        .map((ph) => {
          const id = ph.id as string;
          const rawSection = typeof ph.section === 'string' ? ph.section : 'exclue';
          const section = validSections.has(rawSection) ? rawSection : null; // 'exclue'/inconnu → null
          const ordre = typeof ph.ordre === 'number' && Number.isFinite(ph.ordre) ? Math.trunc(ph.ordre) : 0;
          const legende = typeof ph.legende === 'string' ? ph.legende.trim() : '';
          // apres_paragraphe (LLM, 1-based) -> colonne ancrage_para. Garde si entier >= 1 ET section placee, sinon null (fin de section).
          const apNum = typeof ph.apres_paragraphe === 'number' && Number.isFinite(ph.apres_paragraphe) ? Math.trunc(ph.apres_paragraphe) : null;
          const ancrage_para = section !== null && apNum !== null && apNum >= 1 ? apNum : null;
          return { id, section, ordre, legende, ancrage_para };
        })
    : [];

  if (photoUpdates.length > 0) {
    try {
      const admin = createAdminClient();
      const { data: rapStatut } = await admin
        .from('rapports').select('statut').eq('intervention_id', interventionId).maybeSingle();
      const statut = (rapStatut as { statut?: string } | null)?.statut ?? null;
      if (statut !== 'valide' && statut !== 'transmis') {
        for (const u of photoUpdates) {
          const patch: Record<string, unknown> = { section: u.section, ordre: u.ordre, ancrage_para: u.ancrage_para };
          // La légende ne remplit `label` QUE s'il est vide (jamais écraser une légende humaine).
          if (u.legende && !(labelById.get(u.id) ?? '').trim()) patch.label = u.legende;
          await admin.from('photos_interventions').update(patch).eq('id', u.id);
        }
      }
    } catch (e) {
      console.warn('[tech/generateRapport] persistance photos échouée:', e);
    }
  }

  return {
    ok: true,
    sections: {
      degats: String(parsed.degats ?? '').trim(),
      inspection: String(parsed.inspection ?? '').trim(),
      conclusion: String(parsed.conclusion ?? '').trim(),
      recommandations: String(parsed.recommandations ?? '').trim(),
    },
    techniques_utilisees: techKeysUtil,
    techniques_a_confirmer: techKeysConfirm,
    ...(photosNonAnalysees > 0 ? { photosNonAnalysees } : {}),
  };
}
