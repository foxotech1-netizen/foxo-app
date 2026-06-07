import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { roleForUserId } from '@/lib/auth/server';
import { runAgent } from '@/lib/observability';
import { FOXO_READ_TOOLS, executeFoxoReadTool } from '@/lib/assistant/tools/foxo-read';

// Route chat de l'assistant TECHNICIEN — lecture seule, cloisonnée.
// Garde : rôle 'tech' (rôle en base). Outils : FOXO_READ_TOOLS uniquement
// (PAS d'outils Google = boîte société, PAS d'outils d'action). Le client
// Supabase est cookie-bound (RLS) → les outils ne voient QUE les interventions
// assignées au technicien connecté. Aucun contexte global injecté.

export const maxDuration = 60;

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4096;
const MAX_TURNS = 6;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequest {
  messages: ChatMessage[];
}

function systemForTech(): string {
  return [
    'Tu es l\'assistant du technicien FoxO (Fox Group SRL — détection de fuites en Belgique), accessible depuis son application mobile de terrain.',
    'Tu l\'aides à consulter SES interventions, son planning et les documents de SES dossiers. Tu n\'as accès qu\'aux dossiers qui lui sont assignés.',
    '',
    'Tu disposes d\'OUTILS de lecture (toujours limités à ses propres interventions) :',
    '- search_interventions : retrouver ses dossiers (par référence, statut, dates…).',
    '- get_intervention_detail : ouvrir la fiche complète d\'un de ses dossiers par sa référence.',
    '- get_pipeline_stats : chiffres agrégés sur SES interventions.',
    '- list_intervention_documents : lister les documents (photos, rapports) d\'un de ses dossiers par sa référence.',
    'Utilise ces outils dès qu\'une question dépasse une réponse simple, plutôt que de répondre que tu n\'as pas l\'info. Ne fabrique jamais de chiffres, de dates ni de références.',
    '',
    'Règles :',
    '- Réponds en français, vouvoiement, ton professionnel et concis (lecture sur mobile).',
    '- Tu es en LECTURE SEULE : tu ne peux ni modifier un dossier, ni envoyer de message, ni planifier de rendez-vous. Si on te le demande, indique que ces actions se font dans l\'application ou auprès de l\'administration.',
    '- Si une donnée manque même après recherche, dis-le, ne l\'invente pas.',
  ].join('\n');
}

async function callModel(params: {
  apiKey: string;
  system: string;
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.Tool[];
  inputSummary: Record<string, unknown>;
}): Promise<Anthropic.Message> {
  const { output } = await runAgent<Anthropic.Message>({
    agentName: 'assistant_chat',
    agentKind: 'utility',
    model: MODEL,
    interventionId: null,
    inputSummary: params.inputSummary,
    run: async () => {
      const client = new Anthropic({ apiKey: params.apiKey });
      const msg = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: params.system,
        messages: params.messages,
        ...(params.tools ? { tools: params.tools } : {}),
      });
      const text = msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      const toolNames = msg.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
        .map((b) => b.name);
      return {
        message: msg,
        output: msg,
        outputSummary: {
          stop_reason: msg.stop_reason,
          text_chars: text.length,
          tool_calls: toolNames,
        },
      };
    },
  });
  return output;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || (await roleForUserId(user.id)) !== 'tech') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

  let body: ChatRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Requête invalide.' }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'ANTHROPIC_API_KEY non configurée côté serveur.' }, { status: 500 });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ ok: false, error: 'Aucun message à traiter.' }, { status: 400 });
  }

  const system = systemForTech();

  const sanitized = body.messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.content }));

  if (sanitized.length === 0 || sanitized[sanitized.length - 1].role !== 'user') {
    return NextResponse.json({ ok: false, error: 'Le dernier message doit être de l\'utilisateur.' }, { status: 400 });
  }

  const lastUserChars = sanitized[sanitized.length - 1].content.length;
  const tools = [...FOXO_READ_TOOLS];

  const convo: Anthropic.MessageParam[] = sanitized.map((m) => ({ role: m.role, content: m.content }));

  let raw = '';
  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const msg = await callModel({
        apiKey,
        system,
        messages: convo,
        tools,
        inputSummary: {
          surface: 'tech',
          turn,
          messages_count: convo.length,
          last_user_chars: lastUserChars,
        },
      });

      if (msg.stop_reason === 'tool_use') {
        convo.push({ role: 'assistant', content: msg.content });
        const toolUses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const tu of toolUses) {
          let out: string;
          if (FOXO_READ_TOOLS.some((t) => t.name === tu.name)) {
            out = await executeFoxoReadTool(tu.name, tu.input, supabase);
          } else {
            out = `Outil non disponible pour cet assistant : ${tu.name}.`;
          }
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: out });
        }
        convo.push({ role: 'user', content: results });
        continue;
      }

      raw = msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      break;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ ok: false, error: 'Anthropic : ' + message }, { status: 502 });
  }

  if (!raw) {
    raw = 'Je n\'ai pas pu finaliser ma réponse. Reformulez ou précisez votre demande.';
  }

  return NextResponse.json({ ok: true, content: raw });
}
