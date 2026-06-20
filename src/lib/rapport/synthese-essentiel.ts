// Agent utilitaire `synthese_essentiel` — bloc « L'essentiel » de la couverture
// du rapport PDF.
//
// À partir de la CONCLUSION et de la RECOMMANDATION (saisies à la main dans
// l'admin), produit une synthèse très courte en deux champs :
//   - cause  : la cause la plus probable des dégâts ;
//   - action : l'action recommandée.
// Chaque champ tient en 1-2 phrases COMPLÈTES (jamais de « … »), taillées pour
// la couverture. Tout est best-effort : un échec renvoie null et le rendu PDF
// retombe sur l'ancien comportement (résumé tronqué local).
//
// Observabilité OBLIGATOIRE via runAgent (agent utilitaire `synthese_essentiel`).

import Anthropic from '@anthropic-ai/sdk';
import { runAgent } from '@/lib/observability';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 512;

// Budget de longueur par champ (la couverture a deux colonnes étroites).
const MAX_CHARS = 280;
// Garde-fou dur : au-delà, on rogne à des phrases ENTIÈRES (jamais « … »).
const HARD_CAP = 340;

export type EssentielSynthese = {
  cause: string;
  action: string;
};

function parseJson(raw: string): Record<string, unknown> | null {
  // 1) Tentative directe.
  try {
    const p = JSON.parse(raw);
    if (p && typeof p === 'object') return p as Record<string, unknown>;
  } catch { /* fallthrough */ }
  // 2) Extraction du 1er objet { ... } (gère un éventuel encadrement markdown/prose).
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const p = JSON.parse(raw.slice(start, end + 1));
      if (p && typeof p === 'object') return p as Record<string, unknown>;
    } catch { /* noop */ }
  }
  return null;
}

// Borne la longueur SANS troncature visible : conserve des phrases ENTIÈRES
// jusqu'à maxLen (jamais de coupe en plein mot, jamais de « … »). Au pire,
// renvoie la 1ʳᵉ phrase entière même si elle dépasse maxLen.
function clampSentences(text: string, maxLen = HARD_CAP): string {
  const t = text.trim();
  if (t.length <= maxLen) return t;
  const parts = t.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [t];
  let out = '';
  for (const p of parts) {
    const piece = p.trim();
    const next = out ? `${out} ${piece}` : piece;
    if (next.length > maxLen && out) break;
    out = next;
  }
  return out || t;
}

function normalize(parsed: Record<string, unknown>): EssentielSynthese {
  return {
    cause: clampSentences(String(parsed.cause ?? '').trim()),
    action: clampSentences(String(parsed.action ?? '').trim()),
  };
}

function buildContext(conclusion: string, recommandation: string): string {
  return [
    'CONCLUSION du rapport :',
    conclusion || '(vide)',
    '',
    'RECOMMANDATION du rapport :',
    recommandation || '(vide)',
  ].join('\n');
}

const SYSTEM = [
  "Tu es un assistant qui rédige le bloc « L'essentiel » d'un rapport de recherche de fuite (FoxO, Belgique), destiné au syndic / donneur d'ordre.",
  'On te fournit la CONCLUSION et la RECOMMANDATION complètes du rapport. Tu en produis une synthèse très courte en DEUX champs :',
  '- cause : la cause la plus probable des dégâts, résumée fidèlement.',
  "- action : l'action recommandée, résumée fidèlement.",
  'Règles STRICTES :',
  "1) N'invente RIEN. Reste fidèle au texte fourni ; n'ajoute aucune donnée (adresse, nom, chiffre, étage) absente du texte.",
  `2) Chaque champ : 1 à 2 phrases COMPLÈTES, maximum ${MAX_CHARS} caractères. Ne termine JAMAIS par « … » ni par des points de suspension : la phrase doit être finie.`,
  '3) Va à l\'essentiel : garde la cause et l\'action principales, supprime les détails secondaires.',
  '4) Français clair et professionnel.',
  '5) Réponds UNIQUEMENT en JSON strict, sans markdown.',
  'Format EXACT : {"cause": string, "action": string}',
].join('\n');

// Produit la synthèse « L'essentiel ». Retourne null en cas d'échec (non bloquant).
export async function summarizeEssentiel(args: {
  interventionId: string;
  conclusion: string;
  recommandation: string;
}): Promise<EssentielSynthese | null> {
  const { interventionId, conclusion, recommandation } = args;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const conc = (conclusion ?? '').trim();
  const reco = (recommandation ?? '').trim();
  if (!conc && !reco) return null;

  const context = buildContext(conc, reco);

  try {
    const result = await runAgent<EssentielSynthese | null>({
      agentName: 'synthese_essentiel',
      agentKind: 'utility',
      model: MODEL,
      interventionId,
      inputSummary: {
        conclusion_chars: conc.length,
        recommandation_chars: reco.length,
      },
      run: async () => {
        const client = new Anthropic({ apiKey });
        // Retry interne 1× si JSON invalide (un seul log d'agent, tokens du dernier appel).
        let parsedOut: EssentielSynthese | null = null;
        let lastMsg: Anthropic.Message | null = null;
        for (let attempt = 0; attempt < 2 && !parsedOut; attempt++) {
          const msg = await client.messages.create({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            system: SYSTEM,
            messages: [{ role: 'user', content: context }],
          });
          lastMsg = msg;
          const block = msg.content[0];
          const rawText = block && block.type === 'text' ? block.text : '';
          const parsed = parseJson(rawText);
          if (parsed) parsedOut = normalize(parsed);
          else console.warn(`[synthese_essentiel] JSON invalide (tentative ${attempt + 1}) pour ${interventionId}`);
        }
        return {
          message: lastMsg ?? { usage: { input_tokens: 0, output_tokens: 0 } } as Anthropic.Message,
          output: parsedOut,
          outputSummary: {
            parsed: Boolean(parsedOut),
            cause_chars: parsedOut?.cause.length ?? 0,
            action_chars: parsedOut?.action.length ?? 0,
          },
        };
      },
    });

    const out = result.output;
    if (!out || (!out.cause && !out.action)) return null;
    return out;
  } catch (e) {
    console.warn(`[synthese_essentiel] échec synthèse ${interventionId}:`, e);
    return null;
  }
}
