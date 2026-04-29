import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';
import { getMailDetail } from '@/lib/gmail';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;

export const dynamic = 'force-dynamic';

export interface MailAnalysis {
  nom_client: string | null;
  adresse: string | null;
  type_probleme: string | null;
  telephone: string | null;
  email: string | null;
  date_souhaitee: string | null;
  priorite: 'normale' | 'urgente' | null;
  resume: string | null;
}

const STRIP_FENCE_RE = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/;

function tryParseJson(raw: string): Partial<MailAnalysis> | null {
  const fenced = raw.match(STRIP_FENCE_RE);
  const candidate = fenced ? fenced[1] : raw;
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === 'object') return parsed as Partial<MailAnalysis>;
  } catch { /* try again */ }
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(candidate.slice(start, end + 1)) as Partial<MailAnalysis>; }
    catch { /* noop */ }
  }
  return null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: false, error: 'ANTHROPIC_API_KEY manquante.' }, { status: 500 });

  const { id } = await params;
  const mailRes = await getMailDetail(id);
  if (!mailRes.ok) return NextResponse.json({ ok: false, error: mailRes.error }, { status: 502 });
  const m = mailRes.mail;

  // Préfère le body texte ; sinon strip le HTML
  const bodyText = m.body_text?.trim() ? m.body_text : stripHtml(m.body_html ?? '');
  const truncated = bodyText.slice(0, 6000);

  const userMessage = [
    `Analyse cet email reçu chez FoxO (détection de fuites en Belgique) et extrais les informations utiles pour ouvrir une intervention.`,
    ``,
    `## EMAIL`,
    `From : ${m.from}`,
    `Sujet : ${m.subject}`,
    `Date : ${m.date}`,
    ``,
    truncated,
    ``,
    `## INSTRUCTIONS DE SORTIE`,
    `Retourne UNIQUEMENT du JSON pur, sans backticks, sans markdown autour, avec ces clés (toutes optionnelles, mets null si absent) :`,
    `{`,
    `  "nom_client": "Prénom Nom du demandeur",`,
    `  "adresse": "rue + numéro + code postal + ville si présent",`,
    `  "type_probleme": "Fuite canalisation | Fuite chauffage | Fuite infiltration | Surconsommation eau | Autre",`,
    `  "telephone": "+32... si mentionné",`,
    `  "email": "email du demandeur (souvent égal à From)",`,
    `  "date_souhaitee": "date suggérée par le client (texte libre, ex: 'cette semaine', '2026-05-20')",`,
    `  "priorite": "urgente | normale (urgente si fuite active, dégât en cours)",`,
    `  "resume": "1-2 phrases pour décrire le problème"`,
    `}`,
    `Aucun champ inventé : si l'info n'est pas explicite dans l'email, mets null.`,
  ].join('\n');

  const client = new Anthropic({ apiKey });
  let raw: string;
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: userMessage }],
    });
    const block = msg.content[0];
    raw = block && block.type === 'text' ? block.text : '';
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ ok: false, error: 'Anthropic : ' + message }, { status: 502 });
  }

  const parsed = tryParseJson(raw);
  if (!parsed) {
    return NextResponse.json({ ok: false, error: 'Réponse Claude non parsable.', raw }, { status: 502 });
  }

  const analysis: MailAnalysis = {
    nom_client: typeof parsed.nom_client === 'string' ? parsed.nom_client : null,
    adresse: typeof parsed.adresse === 'string' ? parsed.adresse : null,
    type_probleme: typeof parsed.type_probleme === 'string' ? parsed.type_probleme : null,
    telephone: typeof parsed.telephone === 'string' ? parsed.telephone : null,
    email: typeof parsed.email === 'string' ? parsed.email : null,
    date_souhaitee: typeof parsed.date_souhaitee === 'string' ? parsed.date_souhaitee : null,
    priorite: parsed.priorite === 'urgente' || parsed.priorite === 'normale' ? parsed.priorite : null,
    resume: typeof parsed.resume === 'string' ? parsed.resume : null,
  };

  return NextResponse.json({ ok: true, analysis });
}
