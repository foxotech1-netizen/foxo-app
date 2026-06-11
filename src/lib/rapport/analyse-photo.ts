// PASSE 1 du pipeline Rapport v2 — agent `analyse_photo`.
//
// Pour une photo d'intervention : télécharge le binaire depuis Google Drive
// (drive_file_id), normalise/compresse en JPEG (sharp), envoie à Claude un bloc
// image + le contexte texte, et stocke l'analyse structurée dans
// photos_interventions.analyse_ia. Tout est best-effort : un échec laisse
// analyse_ia à null et n'interrompt jamais la génération du rapport.
//
// Observabilité OBLIGATOIRE via runAgent (agent canonique `analyse_photo`).

import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { createAdminClient } from '@/lib/supabase/admin';
import { getValidAccessToken } from '@/lib/google-auth';
import { runAgent } from '@/lib/observability';
import { RAPPORT_TECHNIQUES } from '@/lib/rapport/techniques';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;

// Seuils de redimensionnement avant envoi à l'API (coût + limites image).
const MAX_BYTES = 1_500_000;   // ~1,5 Mo
const MAX_WIDTH = 2000;        // px

const TYPE_CONTENU = ['degats', 'test', 'resultat', 'localisation', 'document', 'autre'] as const;
type TypeContenu = (typeof TYPE_CONTENU)[number];

export type PhotoAnalyse = {
  description: string;
  type_contenu: TypeContenu;
  lecture_appareil: string | null;
  technique_associee: string | null;   // libellé EXACT de RAPPORT_TECHNIQUES ou null
  qualite_exploitable: boolean;
  legende_proposee: string;
};

export type PhotoToAnalyse = {
  id: string;
  drive_file_id: string | null;
  filename: string | null;
  section: string | null;
  label: string | null;
  observation_test_type?: string | null;
};

const TECHNIQUE_LABELS = new Set<string>(RAPPORT_TECHNIQUES.map((t) => t.label));

// ── Drive download (même mécanisme que build-docx.ts) ────────────────────
async function downloadDriveBytes(fileId: string, token: string): Promise<Buffer | null> {
  try {
    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  }
}

// Normalise en JPEG base64 ; redimensionne si trop lourd ou trop large.
async function toJpegBase64(bytes: Buffer): Promise<string> {
  let buf = bytes;
  try {
    const meta = await sharp(bytes).metadata();
    const tooBig = bytes.byteLength > MAX_BYTES;
    const tooWide = (meta.width ?? 0) > MAX_WIDTH;
    if (tooBig || tooWide || meta.format !== 'jpeg') {
      buf = await sharp(bytes)
        .rotate()
        .resize({ width: MAX_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
    }
  } catch {
    // sharp a échoué (format exotique) — on tente l'envoi des octets bruts.
    buf = bytes;
  }
  return buf.toString('base64');
}

const STRIP_FENCE_RE = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/;
function parseJson(raw: string): Record<string, unknown> | null {
  const fenced = raw.match(STRIP_FENCE_RE);
  const candidate = fenced ? fenced[1] : raw;
  try {
    const p = JSON.parse(candidate);
    if (p && typeof p === 'object') return p as Record<string, unknown>;
  } catch { /* fallthrough */ }
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>; } catch { /* noop */ }
  }
  return null;
}

function normalize(parsed: Record<string, unknown>): PhotoAnalyse {
  const tc = String(parsed.type_contenu ?? 'autre');
  const type_contenu: TypeContenu = (TYPE_CONTENU as readonly string[]).includes(tc) ? (tc as TypeContenu) : 'autre';
  const techRaw = parsed.technique_associee == null ? null : String(parsed.technique_associee).trim();
  // Garde-fou : on ne garde que les libellés EXACTS de la liste fermée.
  const technique_associee = techRaw && TECHNIQUE_LABELS.has(techRaw) ? techRaw : null;
  if (techRaw && !technique_associee) {
    console.warn(`[analyse_photo] technique hors liste fermée ignorée: "${techRaw}"`);
  }
  return {
    description: String(parsed.description ?? '').trim(),
    type_contenu,
    lecture_appareil: parsed.lecture_appareil == null ? null : String(parsed.lecture_appareil).trim() || null,
    technique_associee,
    qualite_exploitable: parsed.qualite_exploitable === true,
    legende_proposee: String(parsed.legende_proposee ?? '').trim(),
  };
}

function buildContext(photo: PhotoToAnalyse, objet: string): string {
  const lines = [
    `Objet de l'intervention : ${objet || '—'}`,
    `Section actuelle de la photo : ${photo.section ?? 'non renseignée'}`,
    `Légende existante : ${photo.label ?? 'aucune'}`,
    `Test terrain rattaché : ${photo.observation_test_type ?? 'aucun'}`,
    '',
    'Liste fermée des techniques (réutilise un libellé EXACT ou null pour technique_associee) :',
    RAPPORT_TECHNIQUES.map((t) => `- ${t.label}`).join('\n'),
  ];
  return lines.join('\n');
}

const SYSTEM = [
  "Tu es un assistant d'analyse d'images pour des rapports de recherche de fuite (FoxO, Belgique).",
  "On te montre UNE photo prise par le technicien sur le terrain. Décris FACTUELLEMENT ce qui est réellement visible, sans rien inventer ni supposer au-delà de l'image.",
  "Si un appareil de mesure est visible avec un affichage, retranscris la lecture (ex : « humidimètre affichant 87 % »).",
  "N'invente aucune donnée administrative (nom, adresse). Réponds UNIQUEMENT en JSON strict, sans markdown.",
  'Format EXACT : {"description": string, "type_contenu": "degats"|"test"|"resultat"|"localisation"|"document"|"autre", "lecture_appareil": string|null, "technique_associee": <libellé exact de la liste fournie>|null, "qualite_exploitable": boolean, "legende_proposee": string}',
].join('\n');

// Analyse une photo et persiste le résultat dans photos_interventions.analyse_ia.
// Retourne l'analyse, ou null en cas d'échec (non bloquant).
export async function analysePhoto(args: {
  interventionId: string;
  objet: string;
  photo: PhotoToAnalyse;
}): Promise<PhotoAnalyse | null> {
  const { interventionId, objet, photo } = args;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !photo.drive_file_id) return null;

  const auth = await getValidAccessToken();
  if (!auth) { console.warn('[analyse_photo] Google non connecté — analyse ignorée.'); return null; }

  const bytes = await downloadDriveBytes(photo.drive_file_id, auth.access_token);
  if (!bytes) { console.warn(`[analyse_photo] download échoué pour ${photo.id}`); return null; }

  let base64: string;
  try {
    base64 = await toJpegBase64(bytes);
  } catch (e) {
    console.warn('[analyse_photo] conversion JPEG échouée:', e);
    return null;
  }

  const context = buildContext(photo, objet);

  try {
    const result = await runAgent<PhotoAnalyse | null>({
      agentName: 'analyse_photo',
      agentKind: 'canonical',
      model: MODEL,
      interventionId,
      inputSummary: {
        photo_id: photo.id,
        section: photo.section ?? null,
        has_label: Boolean(photo.label),
        has_observation: Boolean(photo.observation_test_type),
        bytes_in: bytes.byteLength,
      },
      run: async () => {
        const client = new Anthropic({ apiKey });
        // Retry interne 1× si JSON invalide (un seul log d'agent, tokens du dernier appel).
        let parsedOut: PhotoAnalyse | null = null;
        let lastMsg: Anthropic.Message | null = null;
        for (let attempt = 0; attempt < 2 && !parsedOut; attempt++) {
          const msg = await client.messages.create({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            system: SYSTEM,
            messages: [{
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
                { type: 'text', text: context },
              ],
            }],
          });
          lastMsg = msg;
          const block = msg.content[0];
          const rawText = block && block.type === 'text' ? block.text : '';
          const parsed = parseJson(rawText);
          if (parsed) parsedOut = normalize(parsed);
          else console.warn(`[analyse_photo] JSON invalide (tentative ${attempt + 1}) pour ${photo.id}`);
        }
        return {
          message: lastMsg ?? { usage: { input_tokens: 0, output_tokens: 0 } } as Anthropic.Message,
          output: parsedOut,
          outputSummary: {
            parsed: Boolean(parsedOut),
            type_contenu: parsedOut?.type_contenu ?? null,
            technique_associee: parsedOut?.technique_associee ?? null,
            qualite_exploitable: parsedOut?.qualite_exploitable ?? null,
          },
        };
      },
    });

    const analyse = result.output;
    if (!analyse) return null;

    // Persistance best-effort (service-role).
    try {
      const admin = createAdminClient();
      await admin.from('photos_interventions').update({ analyse_ia: analyse }).eq('id', photo.id);
    } catch (e) {
      console.warn('[analyse_photo] persistance analyse_ia échouée:', e);
    }
    return analyse;
  } catch (e) {
    console.warn(`[analyse_photo] échec analyse ${photo.id}:`, e);
    return null;
  }
}
