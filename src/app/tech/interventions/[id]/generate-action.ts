'use server';

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';
import { getFoxoSystemPrompt } from '@/lib/prompts/rapport';
import type { Acp, Intervention, Occupant, Organisation, Utilisateur } from '@/lib/types/database';
import { runAgent } from '@/lib/observability';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4096;

export type GenerateResult =
  | { ok: true; sections: { degats: string; inspection: string; conclusion: string; recommandations: string } }
  | { ok: false; error: string };

async function assertTechOwner(interventionId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || (roleForEmail(user.email) !== 'tech' && roleForEmail(user.email) !== 'admin')) return { ok: false, error: 'Accès refusé.' };

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
    lines.push(`Date d'intervention : ${d.toLocaleString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`);
  }
  if (iv.started_at && iv.ended_at) {
    const a = new Date(iv.started_at);
    const b = new Date(iv.ended_at);
    const min = Math.round((b.getTime() - a.getTime()) / 60000);
    lines.push(`Durée sur place : ${min} min (${a.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })} → ${b.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })})`);
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
    .select('test_type, etage, localisation, notes, created_at')
    .eq('intervention_id', interventionId)
    .order('created_at', { ascending: true });
  const observations = (obsRes.data ?? []) as Array<{
    test_type: string;
    etage: string | null;
    localisation: string | null;
    notes: string | null;
    created_at: string;
  }>;

  const ctx = buildContextSummary({
    iv,
    acp: acpRes.data as Pick<Acp, 'nom' | 'adresse' | 'code_postal' | 'ville' | 'bce'> | null,
    syndic: orgRes.data as Pick<Organisation, 'nom' | 'type' | 'email' | 'telephone' | 'bce'> | null,
    tech: techRes.data as Pick<Utilisateur, 'prenom' | 'nom'> | null,
    occupants: (occRes.data ?? []) as Occupant[],
    observations,
  });

  const userMessage = [
    `Génère le rapport pour cette intervention FoxO.`,
    ``,
    `## CONTEXTE DOSSIER`,
    ctx,
    ``,
    `## DICTÉE DU TECHNICIEN`,
    trimmed,
    ``,
    `## INSTRUCTIONS DE SORTIE`,
    `- Pour cette demande, tu génères UNIQUEMENT les 4 sections texte du corps : Dégâts, Inspection, Conclusion, Recommandation.`,
    `- Pas de génération .docx, pas de code Node.js, pas d'instructions d'extraction d'images : juste la prose française.`,
    `- Google Calendar et Gmail ne sont PAS disponibles ici — base-toi exclusivement sur le contexte fourni et la dictée.`,
    `- Respecte strictement les règles rédactionnelles du system prompt (prose, "capteur d'humidité", formulations prudentes).`,
    `- Format de réponse : JSON pur, sans backticks, sans markdown autour, avec exactement ces 4 clés :`,
    `  {"degats": "...", "inspection": "...", "conclusion": "...", "recommandations": "..."}`,
    `- Chaque valeur est un texte en prose, plusieurs phrases par section, paragraphes simples séparés par "\\n\\n".`,
  ].join('\n');

  // Agent 3 (rapport) — interventionId connu d'entrée (1er argument).
  // inputSummary STRICTEMENT non-PII : aucune dictée, aucune observation,
  // aucun nom occupant, aucune adresse. Métriques uniquement.
  // outputSummary : indicateurs de présence des sections, jamais le texte
  // rédigé (qui contient potentiellement des PII : occupants, adresses,
  // descriptions de dégâts).
  type RapportSections = { degats?: string; inspection?: string; conclusion?: string; recommandations?: string };
  let parsed: RapportSections;
  try {
    const result = await runAgent<RapportSections>({
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
        has_acp: Boolean(acpRes.data),
        has_syndic: Boolean(orgRes.data),
        has_tech: Boolean(techRes.data),
        has_started_at: Boolean(iv.started_at),
        has_ended_at: Boolean(iv.ended_at),
      },
      run: async () => {
        const client = new Anthropic({ apiKey });
        const msg = await client.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: getFoxoSystemPrompt(),
          messages: [{ role: 'user', content: userMessage }],
        });
        const block = msg.content[0];
        const rawText = block && block.type === 'text' ? block.text : '';

        const parsedRaw = tryParseJson(rawText);
        if (!parsedRaw) {
          console.warn('[tech/generateRapport] JSON parse failed. Raw response:', rawText.slice(0, 500));
          const preview = rawText.slice(0, 200).replace(/\s+/g, ' ');
          throw new Error(`JSON parse: Réponse Claude non parsable (preview: ${preview})`);
        }

        const sections: RapportSections = parsedRaw;
        const lengths = {
          degats: typeof sections.degats === 'string' ? sections.degats.trim().length : 0,
          inspection: typeof sections.inspection === 'string' ? sections.inspection.trim().length : 0,
          conclusion: typeof sections.conclusion === 'string' ? sections.conclusion.trim().length : 0,
          recommandations: typeof sections.recommandations === 'string' ? sections.recommandations.trim().length : 0,
        };
        const sectionsCount = (Object.values(lengths) as number[]).filter((n) => n > 0).length;

        return {
          message: msg,
          output: sections,
          outputSummary: {
            has_degats: lengths.degats > 0,
            has_inspection: lengths.inspection > 0,
            has_conclusion: lengths.conclusion > 0,
            has_recommandations: lengths.recommandations > 0,
            sections_count: sectionsCount,
            degats_length: lengths.degats,
            inspection_length: lengths.inspection,
            conclusion_length: lengths.conclusion,
            recommandations_length: lengths.recommandations,
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

  return {
    ok: true,
    sections: {
      degats: String(parsed.degats ?? '').trim(),
      inspection: String(parsed.inspection ?? '').trim(),
      conclusion: String(parsed.conclusion ?? '').trim(),
      recommandations: String(parsed.recommandations ?? '').trim(),
    },
  };
}
