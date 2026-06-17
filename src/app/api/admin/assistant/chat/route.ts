import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from '@/lib/auth/server';
import { buildGlobalContext, buildInterventionContext } from '@/lib/assistant/context';
import { runAgent } from '@/lib/observability';
import { FOXO_READ_TOOLS, executeFoxoReadTool } from '@/lib/assistant/tools/foxo-read';
import { GOOGLE_READ_TOOLS, executeGoogleReadTool } from '@/lib/assistant/tools/google-read';
import { FOXO_ACTION_TOOLS, executeFoxoActionTool, type PendingAction } from '@/lib/assistant/tools/foxo-actions';

export const maxDuration = 60;

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4096;
const MAX_TURNS = 6;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequest {
  mode: 'global' | 'intervention';
  interventionId?: string;
  messages: ChatMessage[];
  format?: 'text' | 'rapport_json';
}

const STRIP_FENCE_RE = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/;

function tryParseRapportJson(raw: string): { degats: string; inspection: string; conclusion: string; recommandations: string } | null {
  const fenced = raw.match(STRIP_FENCE_RE);
  const candidate = fenced ? fenced[1] : raw;
  const tryOne = (s: string) => {
    try {
      const parsed = JSON.parse(s);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch { /* noop */ }
    return null;
  };
  let parsed = tryOne(candidate);
  if (!parsed) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) parsed = tryOne(candidate.slice(start, end + 1));
  }
  if (!parsed) return null;
  return {
    degats: String(parsed.degats ?? '').trim(),
    inspection: String(parsed.inspection ?? '').trim(),
    conclusion: String(parsed.conclusion ?? '').trim(),
    recommandations: String(parsed.recommandations ?? '').trim(),
  };
}

function systemForMode(mode: 'global' | 'intervention'): string {
  if (mode === 'global') {
    return [
      'Tu es l\'assistant interne de FoxO (Fox Group SRL — détection de fuites en Belgique).',
      'Tu aides l\'admin à piloter le pipeline d\'interventions, prioriser, rédiger des emails au syndic, analyser le planning.',
      '',
      'Tu disposes d\'OUTILS de lecture pour aller chercher des données au-delà du contexte affiché ci-dessous :',
      '- search_interventions : retrouver des dossiers dans toute la base (le contexte n\'affiche que les plus récents).',
      '- get_intervention_detail : ouvrir la fiche complète d\'un dossier par sa référence.',
      '- get_pipeline_stats : chiffres agrégés sur l\'ensemble du pipeline.',
      '- search_emails / get_email_thread / count_unread_emails : consulter la boîte Gmail de la société (recherche en syntaxe Gmail, lecture d\'un fil complet, nombre de non-lus).',
      '- list_calendar_events : consulter l\'agenda de la société sur une période donnée.',
      'Utilise ces outils dès qu\'une question dépasse le contexte fourni, plutôt que de répondre que tu n\'as pas l\'info. Ne fabrique jamais de chiffres ni de références.',
      '',
      'Tu disposes AUSSI d\'OUTILS D\'ACTION (propose_*) : assigner un technicien, planifier un RDV, valider/transmettre un rapport, relancer les occupants, créer un événement dans l\'agenda (propose_creer_evenement_agenda), et préparer un brouillon de réponse à un e-mail (propose_brouillon_reponse_mail). Ces outils ne font RIEN tout seuls : ils PRÉPARENT une proposition que l\'admin confirme d\'un clic « Exécuter ». Quand l\'admin demande l\'une de ces opérations, APPELLE l\'outil propose_* correspondant au lieu de seulement décrire l\'action.',
      'Pour répondre à un e-mail : retrouve d\'abord le fil (search_emails / get_email_thread) pour obtenir l\'identifiant du message, puis propose un brouillon via propose_brouillon_reponse_mail — rien n\'est envoyé, l\'admin relit et envoie depuis Gmail. Tu peux aussi afficher le texte prêt à copier si l\'admin préfère, mais propose le brouillon.',
      '',
      'Règles :',
      '- Réponds en français, ton professionnel mais direct.',
      '- Formatage : texte brut uniquement — pas de tableaux markdown, pas d\'astérisques ou de gras (**), pas de titres #. L\'interface affiche la réponse telle quelle, sans rendu markdown. Pour lister, des tirets simples avec une info par ligne, courte.',
      '- Référence-toi explicitement aux données (ex : "L\'intervention 2026-014 chez Bellevue est urgente").',
      '- Si tu rédiges un email, formate-le proprement (objet + corps), prêt à copier-coller.',
      '- Si tu n\'as pas l\'info même après recherche, dis-le plutôt que d\'inventer.',
      '- Pour les analyses du pipeline, propose des actions concrètes (ex : "Rappeler le syndic X", "Réassigner cette intervention").',
    ].join('\n');
  }
  return [
    'Tu es l\'assistant interne de FoxO sur un dossier d\'intervention spécifique.',
    'L\'admin t\'a ouvert dans le drawer de cette intervention pour t\'aider à rédiger ou analyser.',
    '',
    'Tu disposes d\'outils de lecture : interventions (search_interventions, get_intervention_detail, get_pipeline_stats), emails de la société (search_emails, get_email_thread, count_unread_emails) et agenda (list_calendar_events), si tu dois comparer, retrouver un échange ou citer des chiffres. Le dossier courant est déjà fourni ci-dessous.',
    '',
    'Tu disposes AUSSI d\'OUTILS D\'ACTION (propose_*) : assigner un technicien, planifier un RDV, valider/transmettre un rapport, relancer les occupants, créer un événement dans l\'agenda (propose_creer_evenement_agenda), préparer un brouillon de réponse à un e-mail (propose_brouillon_reponse_mail). Ils ne font RIEN seuls : ils PRÉPARENT une proposition que l\'admin confirme d\'un clic « Exécuter ». Quand l\'admin demande une telle opération, APPELLE l\'outil propose_* correspondant.',
    '',
    'Règles :',
    '- Réponds en français, ton professionnel.',
    '- Formatage : texte brut uniquement — pas de tableaux markdown, pas d\'astérisques ou de gras (**), pas de titres #. L\'interface affiche la réponse telle quelle, sans rendu markdown. Pour lister, des tirets simples avec une info par ligne. Cette règle ne s\'applique pas au mode rapport_json ci-dessous, qui reste du JSON pur.',
    '- Base-toi en priorité sur les données du dossier ci-dessous.',
    '- Quand on te demande de répondre à un e-mail, retrouve le fil (get_email_thread) et propose un brouillon via propose_brouillon_reponse_mail (rien n\'est envoyé) ; tu peux aussi afficher le message prêt à copier (objet + corps) si l\'admin préfère.',
    '- Quand on te demande un résumé, sois synthétique (max 3-4 lignes).',
    '- Si une donnée manque, dis-le, ne l\'invente pas.',
    '- Quand on te demande de rédiger les 4 sections du rapport (format=rapport_json), retourne UNIQUEMENT du JSON pur (pas de backticks, pas de markdown autour) avec exactement les clés "degats", "inspection", "conclusion", "recommandations". Chaque valeur est une prose française en plusieurs phrases. Respecte les conventions FoxO ("capteur d\'humidité" et non "humidimétrique", formulations prudentes).',
  ].join('\n');
}

async function callModel(params: {
  apiKey: string;
  system: string;
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.Tool[];
  interventionId: string | null;
  inputSummary: Record<string, unknown>;
}): Promise<Anthropic.Message> {
  const { output } = await runAgent<Anthropic.Message>({
    agentName: 'assistant_chat',
    agentKind: 'utility',
    model: MODEL,
    interventionId: params.interventionId,
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
  if (!user || !(await isAdminUser())) {
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

  let contextBlock: string;
  if (body.mode === 'intervention') {
    if (!body.interventionId) {
      return NextResponse.json({ ok: false, error: 'interventionId manquant.' }, { status: 400 });
    }
    const ctx = await buildInterventionContext(body.interventionId);
    if (!ctx) return NextResponse.json({ ok: false, error: 'Intervention introuvable.' }, { status: 404 });
    contextBlock = ctx;
  } else {
    contextBlock = await buildGlobalContext();
  }

  const system = [
    systemForMode(body.mode),
    '',
    '── DONNÉES À TA DISPOSITION ──',
    contextBlock,
  ].join('\n');

  const sanitized = body.messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.content }));

  if (sanitized.length === 0 || sanitized[sanitized.length - 1].role !== 'user') {
    return NextResponse.json({ ok: false, error: 'Le dernier message doit être de l\'utilisateur.' }, { status: 400 });
  }

  const lastUserChars = sanitized[sanitized.length - 1].content.length;
  const formatRequested = body.format ?? 'text';
  const useTools = formatRequested !== 'rapport_json';
  const tools = useTools ? [...FOXO_READ_TOOLS, ...GOOGLE_READ_TOOLS, ...FOXO_ACTION_TOOLS] : undefined;
  const interventionId = body.mode === 'intervention' ? (body.interventionId ?? null) : null;

  const convo: Anthropic.MessageParam[] = sanitized.map((m) => ({ role: m.role, content: m.content }));

  let raw = '';
  const pendingActions: PendingAction[] = [];
  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const msg = await callModel({
        apiKey,
        system,
        messages: convo,
        tools,
        interventionId,
        inputSummary: {
          mode: body.mode,
          format_requested: formatRequested,
          turn,
          messages_count: convo.length,
          last_user_chars: lastUserChars,
          context_chars: contextBlock.length,
        },
      });

      if (msg.stop_reason === 'tool_use') {
        convo.push({ role: 'assistant', content: msg.content });
        const toolUses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const tu of toolUses) {
          let out: string;
          if (FOXO_ACTION_TOOLS.some((t) => t.name === tu.name)) {
            const actionRes = await executeFoxoActionTool(tu.name, tu.input, supabase);
            out = actionRes.resultForModel;
            if (actionRes.pendingAction) pendingActions.push(actionRes.pendingAction);
          } else if (FOXO_READ_TOOLS.some((t) => t.name === tu.name)) {
            out = await executeFoxoReadTool(tu.name, tu.input, supabase);
          } else {
            out = await executeGoogleReadTool(tu.name, tu.input);
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
    raw = 'Je n\'ai pas pu finaliser ma réponse après plusieurs étapes de recherche. Reformule ou précise ta demande.';
  }

  if (body.format === 'rapport_json') {
    const sections = tryParseRapportJson(raw);
    if (!sections) {
      return NextResponse.json({
        ok: true,
        content: raw,
        warning: 'Réponse non parsable comme JSON, affichée en texte brut.',
      });
    }
    return NextResponse.json({ ok: true, content: raw, sections });
  }

  return NextResponse.json({ ok: true, content: raw, pendingActions });
}
