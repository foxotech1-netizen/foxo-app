import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';
import { buildGlobalContext, buildInterventionContext } from '@/lib/assistant/context';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4096;

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
      'Règles :',
      '- Réponds en français, ton professionnel mais direct.',
      '- Référence-toi explicitement au contexte fourni (ex : "L\'intervention 2026-014 chez Bellevue est urgente").',
      '- Si tu rédiges un email, formate-le proprement (objet + corps), prêt à copier-coller.',
      '- Si tu n\'as pas l\'info, dis-le plutôt que d\'inventer. Ne fabrique pas de chiffres.',
      '- Pour les analyses du pipeline, propose des actions concrètes (ex : "Rappeler le syndic X", "Réassigner cette intervention").',
    ].join('\n');
  }
  return [
    'Tu es l\'assistant interne de FoxO sur un dossier d\'intervention spécifique.',
    'L\'admin t\'a ouvert dans le drawer de cette intervention pour t\'aider à rédiger ou analyser.',
    '',
    'Règles :',
    '- Réponds en français, ton professionnel.',
    '- Base-toi exclusivement sur les données du dossier ci-dessous.',
    '- Quand on te demande de rédiger un email, sors directement le message prêt à copier (objet + corps).',
    '- Quand on te demande un résumé, sois synthétique (max 3-4 lignes).',
    '- Si une donnée manque, dis-le, ne l\'invente pas.',
    '- Quand on te demande de rédiger les 4 sections du rapport (format=rapport_json), retourne UNIQUEMENT du JSON pur (pas de backticks, pas de markdown autour) avec exactement les clés "degats", "inspection", "conclusion", "recommandations". Chaque valeur est une prose française en plusieurs phrases. Respecte les conventions FoxO ("capteur d\'humidité" et non "humidimétrique", formulations prudentes).',
  ].join('\n');
}

export async function POST(request: Request) {
  // Guard admin
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
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

  // Construit le contexte FoxO selon le mode
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

  // Filtre/sanitize l'historique
  const messages = body.messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.content }));

  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    return NextResponse.json({ ok: false, error: 'Le dernier message doit être de l\'utilisateur.' }, { status: 400 });
  }

  const client = new Anthropic({ apiKey });

  let raw: string;
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages,
    });
    const block = msg.content[0];
    raw = block && block.type === 'text' ? block.text : '';
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    console.warn('[admin/assistant] Anthropic error:', e);
    return NextResponse.json({ ok: false, error: 'Anthropic : ' + message }, { status: 502 });
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

  return NextResponse.json({ ok: true, content: raw });
}
