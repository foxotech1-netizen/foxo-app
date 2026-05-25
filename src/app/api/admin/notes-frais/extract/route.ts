import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from '@/lib/auth/server';
import { runAgent } from '@/lib/observability';
import type { NoteFrais } from '@/lib/types/database';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MODEL = 'claude-sonnet-4-20250514';

const SYSTEM_PROMPT = `Tu es un assistant OCR pour notes de frais. Extrais du ticket :
- montant_htva (number)
- taux_tva (number, 0|6|12|21)
- montant_ttc (number)
- fournisseur (string)
- date_depense (string YYYY-MM-DD)
- description (string)

Réponds UNIQUEMENT en JSON valide, sans markdown ni commentaire.`;

interface ExtractedFields {
  montant_htva?: number;
  taux_tva?: number;
  montant_ttc?: number;
  fournisseur?: string;
  date_depense?: string;
  description?: string;
}

interface AgentOutput {
  rawText: string;
  parsed: ExtractedFields | null;
  parseError: boolean;
}

// Score 0.9 si tous les champs structurés sont présents, 0.7 si seul
// le montant_ttc l'est (cas le plus fréquent — ticket flou), 0.4 sinon.
function computeConfidence(e: ExtractedFields): number {
  const present = (v: unknown): boolean => v !== undefined && v !== null && v !== '';
  const fields = [e.montant_htva, e.taux_tva, e.montant_ttc, e.fournisseur, e.date_depense];
  const count = fields.filter(present).length;
  if (count >= 4) return 0.9;
  if (present(e.montant_ttc)) return 0.7;
  return 0.4;
}

function countFieldsPresent(e: ExtractedFields): number {
  const present = (v: unknown): boolean => v !== undefined && v !== null && v !== '';
  return [e.montant_htva, e.taux_tva, e.montant_ttc, e.fournisseur, e.date_depense, e.description]
    .filter(present).length;
}

// POST /api/admin/notes-frais/extract
//
// Body : { id: string }
//
// Pipe la photo du ticket (note.photo_url) vers Claude (vision) avec un
// prompt OCR structuré, parse la réponse JSON, calcule un score de
// confiance, et patch la note :
//   - ia_raw + ia_confiance toujours
//   - autres champs (montant_*, fournisseur, date_depense, description)
//     uniquement si statut = 'brouillon' — on n'écrase pas une note déjà
//     soumise/approuvée.
//
// Retour : { ok: true, data: NoteFrais } ou { ok: false, error: string }
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

  let body: { id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }
  const id = typeof body.id === 'string' ? body.id : null;
  if (!id) {
    return NextResponse.json({ ok: false, error: 'id requis.' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: noteRaw, error: fErr } = await admin
    .from('notes_frais')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fErr) return NextResponse.json({ ok: false, error: fErr.message }, { status: 500 });
  if (!noteRaw) return NextResponse.json({ ok: false, error: 'Note introuvable.' }, { status: 404 });
  const note = noteRaw as NoteFrais;

  if (!note.photo_url) {
    return NextResponse.json({ ok: false, error: 'Aucune photo à extraire.' }, { status: 400 });
  }
  const photoUrl: string = note.photo_url;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'ANTHROPIC_API_KEY manquante.' }, { status: 500 });
  }

  let agentResult: AgentOutput;
  try {
    const { output } = await runAgent<AgentOutput>({
      agentName: 'notes_frais_extract',
      agentKind: 'utility',
      model: MODEL,
      interventionId: null,
      inputSummary: {
        has_photo_url: true,
        statut: note.statut,
      },
      run: async () => {
        const client = new Anthropic({ apiKey });
        const msg = await client.messages.create({
          model: MODEL,
          max_tokens: 500,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', source: { type: 'url', url: photoUrl } },
                { type: 'text', text: 'Extrais les champs structurés du ticket joint.' },
              ],
            },
          ],
        });

        const textBlock = msg.content.find((b) => b.type === 'text');
        if (!textBlock || textBlock.type !== 'text') {
          throw new Error('Réponse Anthropic sans texte.');
        }

        const rawText = textBlock.text;
        let parsed: ExtractedFields | null = null;
        let parseError = false;
        try {
          // Claude peut parfois entourer le JSON de balises markdown — on nettoie.
          const cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
          parsed = JSON.parse(cleaned) as ExtractedFields;
        } catch {
          parseError = true;
        }

        const fieldsPresent = parsed ? countFieldsPresent(parsed) : 0;
        const confidence = parsed ? computeConfidence(parsed) : 0;

        return {
          message: msg,
          output: { rawText, parsed, parseError },
          outputSummary: {
            raw_chars: rawText.length,
            parse_error: parseError,
            fields_present_count: fieldsPresent,
            confidence,
          },
        };
      },
    });
    agentResult = output;
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : 'Erreur Anthropic.',
    }, { status: 502 });
  }

  if (agentResult.parseError || !agentResult.parsed) {
    return NextResponse.json({
      ok: false,
      error: 'JSON IA invalide.',
      raw: agentResult.rawText.slice(0, 300),
    }, { status: 502 });
  }

  const parsed = agentResult.parsed;
  const confidence = computeConfidence(parsed);
  const patch: Record<string, unknown> = {
    ia_raw: parsed,
    ia_confiance: confidence,
  };

  // Pré-remplissage seulement si la note est encore éditable.
  if (note.statut === 'brouillon') {
    if (typeof parsed.montant_htva === 'number') patch.montant_htva = parsed.montant_htva;
    if (typeof parsed.taux_tva === 'number')     patch.taux_tva     = parsed.taux_tva;
    if (typeof parsed.montant_ttc === 'number')  patch.montant_ttc  = parsed.montant_ttc;
    if (typeof parsed.fournisseur === 'string')  patch.fournisseur  = parsed.fournisseur;
    if (typeof parsed.date_depense === 'string') patch.date_depense = parsed.date_depense;
    if (typeof parsed.description === 'string')  patch.description  = parsed.description;
  }

  const { data: updated, error: uErr } = await admin
    .from('notes_frais')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (uErr) return NextResponse.json({ ok: false, error: uErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, data: updated as NoteFrais });
}
