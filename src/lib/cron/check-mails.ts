// Logique partagée POST /api/cron/check-mails (envoi) et
// GET /preview (dry-run). Aucune action vers les clients.
//
// Workflow par mail :
//   1. Liste les mails INBOX is:unread
//   2. Skip si déjà labelisé FOXO_TRAITE (sécurité — Gmail filtre déjà
//      via la query, mais double-check côté code)
//   3. Charge le détail (body)
//   4. Claude → JSON { ..., est_demande_intervention: bool }
//   5a. Si oui : crée intervention statut='nouvelle' source='mail'
//       + label FOXO_TRAITE + retire UNREAD + insert timeline
//   5b. Sinon : label FOXO_LU + retire UNREAD (pas une demande)
//   6. Insert sms_logs.type='mail_entrant'

import Anthropic from '@anthropic-ai/sdk';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  listInboxMails,
  getMailDetail,
  addLabelToMail,
} from '@/lib/gmail';
import { nextRefForYear } from '@/lib/intervention-ref';
import { bestMatch } from '@/lib/text/similarity';
import { runAgent } from '@/lib/observability';

const MODEL = 'claude-sonnet-4-6';
// Le JSON nested du nouveau prompt FoxO (demandeur.contacts[],
// acp, intervention, occupants[], assurance, action_requise, …)
// dépasse facilement 1024 tokens — surtout avec plusieurs contacts +
// plusieurs occupants. 1024 → réponse tronquée → unparsable.
const MAX_TOKENS = 4096;

// Limites runtime — chaque étape du pipeline est bornée par un timeout pour
// rester sous le plafond Vercel Hobby (maxDuration=60s) et éviter le 504
// FUNCTION_INVOCATION_TIMEOUT. Hotfix 504 récurrent : 1 seul mail par run.
const MAX_MAILS_PER_RUN = 1;
const GMAIL_TIMEOUT_MS = 10_000;
const CLAUDE_TIMEOUT_MS = 20_000;
// Borne la phase DB de createInterventionFromMail (N round-trips Supabase +
// cascades de retry interventions×5 / occupants×6) qui n'était protégée par
// aucun timeout. Sur dépassement : on log, on NE labellise PAS le mail (pas
// de FOXO_TRAITE) et on continue — le mail est repris au run suivant.
const DB_TIMEOUT_MS = 30_000;

// Wrapper timeout Promise.race — sert pour les appels où on n'a pas
// d'AbortController natif (ex: helpers Gmail qui n'exposent pas de
// signal). Le fetch sous-jacent continue jusqu'à sa propre fin, mais
// runCheckMails reprend la main au timeout.
async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Timeout ${ms}ms: ${label}`)), ms);
  });
  try {
    return await Promise.race([p, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export type CronOccupantType =
  | 'occupant'
  | 'proprietaire'
  | 'locataire'
  | 'concierge'
  | 'voisin'
  | 'gestionnaire'
  | 'parties_communes'
  | 'autre';

// Doit rester aligné avec le CHECK SQL
// (cf. db/migrations/2026-05-29_occupant_types_extended.sql).
const ALLOWED_CRON_OCCUPANT_TYPES = new Set<CronOccupantType>([
  'occupant', 'proprietaire', 'locataire', 'concierge',
  'voisin', 'gestionnaire', 'parties_communes', 'autre',
]);

export interface CronExtractedOccupant {
  prenom: string;
  nom: string;
  email: string;
  appartement: string;
  etage: string;
  telephone: string;
  type: CronOccupantType;
  notes: string;            // remarques (clés, accès, urgence, état apt)
}

export type CronDemandeurType = 'syndic' | 'courtier' | 'particulier';

// Délégué = la personne physique qui envoie le mail au nom du syndic.
// Le syndic = nom_societe (organisation). Le délégué a son propre nom +
// email + téléphone (souvent dans la signature).
export interface CronDelegueExtracted {
  prenom: string | null;
  nom: string | null;
  email: string | null;
  telephone: string | null;
}

// Bloc assurance/courtier — persisté dans interventions.assureur (jsonb)
// après la migration 2026-05-20 ; fallback dans particulier_contact.assureur
// pour les bases qui n'ont pas encore appliqué la migration.
export interface CronInsuranceExtracted {
  nom_contact: string | null;
  email: string | null;
  telephone: string | null;
  reference_sinistre: string | null;
  reference_police: string | null;
}

// Contact d'un demandeur (ex: plusieurs gestionnaires d'un même syndic).
// Persisté dans la table delegues — un de ces contacts est marqué
// est_principal et finit dans intervention.delegue_id.
export interface CronDemandeurContact {
  nom: string;
  prenom: string;
  email: string;
  telephone: string;
  est_principal: boolean;
}

// Type du mail — détermine si on crée une intervention ou pas.
// Seuls 'nouvelle_demande' et (parfois) 'rapport_demande') déclenchent
// une création. 'assurance' = mail courtier sur dossier existant
// (déclenche un rattachement, pas une création).
export type CronMailType =
  | 'nouvelle_demande'
  | 'suivi_dossier'
  | 'confirmation_rdv'
  | 'annulation'
  | 'rapport_demande'
  | 'assurance'
  | 'autre';

export interface CronMailAnalysis {
  est_demande_intervention: boolean;
  type_email: CronMailType | null;
  // Champs aplatis (rétrocompat avec le code aval qui les lit).
  // Ils sont populés depuis demandeur/acp/intervention par le parser.
  nom_client: string | null;
  adresse: string | null;
  type_probleme: string | null;
  telephone: string | null;
  email: string | null;
  priorite: 'normale' | 'urgente' | null;
  resume: string | null;
  langue: 'fr' | 'nl' | 'en' | null;
  occupants: CronExtractedOccupant[];
  type_demandeur: CronDemandeurType | null;
  nom_societe: string | null;
  nom_immeuble: string | null;
  adresse_immeuble: string | null;
  reference_externe: string | null;
  delegue: CronDelegueExtracted | null;
  // Nouveaux champs (prompt FoxO opérationnel).
  description_precise: string | null;
  appartements_concernes: string[];
  zones_communes: string[];
  assurance: CronInsuranceExtracted | null;
  action_requise: string | null;
  contacts: CronDemandeurContact[];
}

export interface CronMailResultItem {
  mail_id: string;
  from: string;
  subject: string;
  action: 'created_intervention' | 'labeled_lu' | 'skipped' | 'error';
  intervention_id?: string;
  ref?: string;
  analysis?: CronMailAnalysis;
  error?: string;
}

export interface CronMailResult {
  processed: number;
  created: number;
  labeled_lu: number;
  skipped: number;
  errors: number;
  items: CronMailResultItem[];
}

const STRIP_FENCE_RE = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/;

// Tente de réparer un JSON tronqué (ex: réponse Claude coupée par
// max_tokens). Stratégie : depuis la fin, ferme les strings ouverts,
// puis ferme les objets/arrays ouverts dans le bon ordre.
// Best-effort — si la troncature tombe au milieu d'un nombre ou d'un
// littéral (true/false/null), ça échoue toujours.
function repairTruncatedJson(input: string): string {
  let s = input.trimEnd();
  // Retire trailing comma inutile
  s = s.replace(/,\s*$/, '');
  // Compte les guillemets non-escapés pour détecter une string ouverte
  let inString = false;
  const stack: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i++; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' && stack[stack.length - 1] === '{') stack.pop();
    else if (c === ']' && stack[stack.length - 1] === '[') stack.pop();
  }
  // Ferme une éventuelle string ouverte
  if (inString) s += '"';
  // Retire un dernier ":" ou "," orphelin avant fermeture
  s = s.replace(/[,:]\s*$/, '');
  // Ferme les conteneurs dans l'ordre LIFO
  while (stack.length > 0) {
    const open = stack.pop();
    s += open === '{' ? '}' : ']';
  }
  return s;
}

function tryParseJson(raw: string): Partial<CronMailAnalysis> | null {
  // 1. Direct (avec strip de fences markdown s'il y en a)
  const fenced = raw.match(STRIP_FENCE_RE);
  const candidate = fenced ? fenced[1] : raw;
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === 'object') return parsed as Partial<CronMailAnalysis>;
  } catch { /* try next */ }

  // 2. Slice entre 1er { et dernier } — utile si Claude ajoute un
  //    préambule ('Here is the JSON:') ou un postambule.
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1)) as Partial<CronMailAnalysis>;
    } catch { /* try next */ }
  }

  // 3. Réparation : Claude tronqué par max_tokens. On prend tout ce
  //    qui suit le 1er { et on tente de fermer ce qui est ouvert.
  if (start >= 0) {
    const tail = candidate.slice(start);
    const repaired = repairTruncatedJson(tail);
    try {
      return JSON.parse(repaired) as Partial<CronMailAnalysis>;
    } catch { /* abandon */ }
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

function extractEmailAddr(from: string): string | null {
  const m = from.match(/<([^>]+)>/);
  return m ? m[1].trim() : (from.includes('@') ? from.trim() : null);
}

function splitName(full: string | null | undefined): { prenom: string; nom: string } {
  if (!full) return { prenom: '', nom: '' };
  const parts = full.trim().split(/\s+/);
  if (parts.length >= 2) return { prenom: parts[0], nom: parts.slice(1).join(' ') };
  return { prenom: '', nom: full.trim() };
}

// Parse une liste d'adresses RFC 2822 ("Nom <email>, Nom2 <email2>") en
// paires { name, email }. Tolérant aux quotes, espaces, accents.
function parseAddressList(raw: string): { name: string; email: string }[] {
  if (!raw) return [];
  // Split sur virgule en respectant les guillemets (un nom quoté peut
  // contenir une virgule : "Dupont, Pierre" <email>).
  const parts = raw.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: { name: string; email: string }[] = [];
  for (const p of parts) {
    const m = p.match(/^"?([^"<]+?)"?\s*<([^>]+)>$/);
    if (m) {
      out.push({ name: m[1].trim(), email: m[2].trim() });
    } else if (p.includes('@')) {
      // Adresse nue, sans nom
      out.push({ name: '', email: p.trim().replace(/^<|>$/g, '') });
    }
  }
  return out;
}

function parseAdresse(s: string | null | undefined): { rue: string; cp: string; ville: string } {
  if (!s) return { rue: '', cp: '', ville: '' };
  const m = s.match(/^(.+?),?\s*(\d{4})\s+(.+?)$/);
  if (m) return { rue: m[1].trim(), cp: m[2].trim(), ville: m[3].trim() };
  return { rue: s.trim(), cp: '', ville: '' };
}

const ALLOWED_TYPES = [
  'Fuite canalisation',
  'Fuite chauffage',
  'Fuite infiltration',
  'Surconsommation eau',
  'Autre',
] as const;

export async function analyzeMailWithClaude(
  apiKey: string,
  mail: { from: string; subject: string; date: string; cc: string; body_text: string; body_html: string },
): Promise<{ ok: true; analysis: CronMailAnalysis } | { ok: false; error: string }> {
  // Combine body_text + HTML stripé pour donner à Claude le contenu le
  // plus complet possible. Certains mails ont uniquement HTML, d'autres
  // mélangent les deux. La concaténation peut produire des doublons mais
  // c'est OK — Claude ignore les répétitions.
  const txt = (mail.body_text ?? '').trim();
  const htmlStripped = stripHtml(mail.body_html ?? '').trim();
  let combined = '';
  if (txt && htmlStripped && txt.length > htmlStripped.length * 1.2) {
    combined = txt;
  } else if (txt && htmlStripped) {
    // Préfère HTML stripé (souvent plus structuré), texte en fallback
    combined = htmlStripped.length > txt.length ? htmlStripped : txt;
  } else {
    combined = txt || htmlStripped;
  }
  const truncated = combined.slice(0, 8000);
  const wordCount = truncated.split(/\s+/).filter(Boolean).length;

  // Liste CC pré-parsée
  const ccPairs = parseAddressList(mail.cc ?? '');
  const ccBlock = ccPairs.length > 0
    ? ccPairs.map((p) => `- "${p.name}" <${p.email}>`).join('\n')
    : '(aucun)';

  const systemPrompt = [
    `Tu es l'assistant opérationnel de FoxO, spécialisé dans la détection de fuites pour des résidences gérées par des syndics à Bruxelles.`,
    ``,
    `Analyse ce mail et extrait TOUTES les informations en JSON strict. Lis TOUT le corps du mail et les CC.`,
    ``,
    `## CONTACTS RÉCURRENTS À RECONNAÎTRE`,
    `- Regimo SRL : Thomas Malrain, Mariana Cabral de Almeida, Alexis Kotsaridis`,
    `- IGS / IG Syndic : Caroline Mignon (cm@igsyndic.be), Kevin Duwyn (kd@igsyndic.be)`,
    `- Ettik / B-Safe : Frédéric Aelvoet (assurance/facturation)`,
    `- Moons Assurances : Alain Moons`,
    `- Carmelo Allegretti : entrepreneur`,
    ``,
    `## RÈGLES D'EXTRACTION`,
    `- Lis TOUT le corps du mail, ne t'arrête pas à la première mention.`,
    `- Chaque adresse en CC est un occupant potentiel à identifier.`,
    `- Format occupant typique : "Apt X (Nom Prénom)", "Appartement X — Nom",`,
    `  ou "• AXX — NOM Prénom — 04XX XX XX XX / email".`,
    `- Si quelqu'un détient des clés de l'apt voisin → mets dans 'remarques'.`,
    `- Si une référence sinistre est mentionnée → mets dans acp.reference_sinistre.`,
    `- Si le mail est juste un suivi/confirmation (pas une nouvelle demande) →`,
    `  est_demande_intervention=false ET type_email approprié.`,
    `- Si spam/newsletter/automatique → est_demande_intervention=false, type_email="autre".`,
    ``,
    `## CROISEMENT CC ↔ OCCUPANTS (CRITIQUE)`,
    `Pour chaque occupant mentionné dans le corps du mail, CHERCHE son email`,
    `dans la liste des CC en faisant correspondre le NOM DE FAMILLE`,
    `(insensible à la casse, tolérant aux variations).`,
    ``,
    `Exemples :`,
    `  Corps : "appartement K09 (Mme Vlasselaer)"`,
    `  CC    : - "Cristina Vlasselaer" <crisvelarde@gmail.com>`,
    `  → occupant Vlasselaer reçoit email = crisvelarde@gmail.com`,
    ``,
    `  Corps : "magasin M09 (Mr Leman)"`,
    `  CC    : - "Pierre-Henri Leman" <pierrehenrileman@gmail.com>`,
    `  → occupant Leman reçoit email = pierrehenrileman@gmail.com`,
    ``,
    `  Corps : "apt 3B (Marie Dupont)"`,
    `  CC    : - "Dupont, Marie" <marie.dupont@example.com>`,
    `  → occupant Dupont reçoit email = marie.dupont@example.com`,
    ``,
    `Règles :`,
    `- Si le nom dans le CC contient le nom de famille de l'occupant (substring`,
    `  case-insensitive) → c'est un match. Préfère le match le plus long si`,
    `  plusieurs CC matchent.`,
    `- Si l'email du CC contient le nom de famille (ex: vlasselaer@…) → match`,
    `  même sans nom d'affichage.`,
    `- N'invente JAMAIS un email — soit tu trouves un match dans les CC, soit`,
    `  tu laisses email="" pour cet occupant.`,
    `- Les CC qui ne matchent aucun occupant du corps deviennent eux-mêmes des`,
    `  occupants (un occupant par CC orphelin avec son nom et son email).`,
    `- IGNORE les CC internes : foxo.be, le sender lui-même, le syndic.`,
    ``,
    `## type_email`,
    `- "nouvelle_demande" : nouvelle intervention à planifier`,
    `- "suivi_dossier" : relance/échange sur un dossier existant`,
    `- "confirmation_rdv" : confirmation de rendez-vous`,
    `- "annulation" : annulation d'intervention`,
    `- "rapport_demande" : demande de rapport sur intervention faite`,
    `- "assurance" : mail courtier (sinistre, police, expertise) sur dossier existant`,
    `- "autre" : tout le reste (spam, newsletter, fournisseur, interne…)`,
    ``,
    `## demandeur.type`,
    `- "syndic" : copropriété, ACP, immeuble, AG, parties communes, gestionnaire`,
    `- "courtier" : assurance, sinistre, police, compagnie, expertise, dégât assuré`,
    `- "particulier" : demande personnelle, maison/appartement perso`,
    ``,
    `## SORTIE — UNIQUEMENT ce JSON sans markdown ni backticks`,
    `{`,
    `  "est_demande_intervention": true | false,`,
    `  "type_email": "nouvelle_demande" | "suivi_dossier" | "confirmation_rdv" | "annulation" | "rapport_demande" | "assurance" | "autre",`,
    ``,
    `  "demandeur": {`,
    `    "type": "syndic" | "courtier" | "particulier" | null,`,
    `    "nom_societe": "string ou null",`,
    `    "contacts": [`,
    `      {`,
    `        "nom": "string",`,
    `        "prenom": "string",`,
    `        "email": "string ou \\"\\"",`,
    `        "telephone": "string ou \\"\\"",`,
    `        "est_principal": true | false`,
    `      }`,
    `    ]`,
    `  },`,
    ``,
    `  "acp": {`,
    `    "nom": "string ou null",`,
    `    "adresse": "string ou null",`,
    `    "code_postal": "string ou null",`,
    `    "ville": "string ou null"`,
    `  },`,
    ``,
    `  "intervention": {`,
    `    "type_probleme": "Fuite canalisation" | "Fuite chauffage" | "Fuite infiltration" | "Surconsommation eau" | "Recherche fuite" | "Humidité" | "Autre" | null,`,
    `    "description_precise": "string ou null",`,
    `    "priorite": "normale" | "urgente",`,
    `    "appartements_concernes": ["A03", "A04", ...],`,
    `    "zones_communes": ["RDC escaliers", ...]`,
    `  },`,
    ``,
    `  "occupants": [`,
    `    {`,
    `      "appartement": "string ou \\"\\"",`,
    `      "nom": "string ou \\"\\"",`,
    `      "prenom": "string ou \\"\\"",`,
    `      "email": "string ou \\"\\"",`,
    `      "telephone": "string ou \\"\\"",`,
    `      "type": "occupant" | "proprietaire" | "locataire" | "concierge" | "voisin" | "gestionnaire" | "parties_communes" | "autre",`,
    `      "remarques": "string courte ou \\"\\""`,
    `    }`,
    `  ],`,
    ``,
    `  "assurance": {`,
    `    "nom_contact": "string ou null",`,
    `    "email": "string ou null",`,
    `    "telephone": "string ou null",`,
    `    "reference_sinistre": "string ou null",`,
    `    "reference_police": "string ou null"`,
    `  } | null,`,
    ``,
    `  "resume": "1-2 phrases ou null",`,
    `  "priorite": "normale" | "urgente",`,
    `  "langue": "fr" | "nl" | "en",`,
    `  "reference_externe": "string ou null",`,
    `  "action_requise": "string ou null"`,
    `}`,
    ``,
    `IMPORTANT :`,
    `- Aucun champ inventé : si l'info n'est pas explicite, null (ou "" pour les strings d'occupant).`,
    `- Si aucun occupant identifié MAIS zone commune touchée → au moins une entrée parties_communes.`,
    `- Sinon "occupants": [].`,
    `- Si pas d'assurance mentionnée → tous les champs assurance à null.`,
    `- Le From: doit toujours être identifiable comme demandeur.email_contact / nom_contact (au moins).`,
    `- Pour le champ occupants[].type, choisis le plus précis :`,
    `   "occupant"         = résident principal de l'appartement (défaut si non précisé)`,
    `   "proprietaire"     = propriétaire bailleur qui ne réside pas`,
    `   "locataire"        = locataire identifié distinct du résident`,
    `   "concierge"        = concierge / loge`,
    `   "voisin"           = voisin sollicité pour accès ou nuisance`,
    `   "gestionnaire"     = gestionnaire d'immeuble / régie`,
    `   "parties_communes" = zone commune sans résident (escaliers, hall, parking…)`,
    `   "autre"            = ne rentre dans aucune catégorie ci-dessus.`,
  ].join('\n');

  const userMessage = [
    `## EMAIL`,
    `From    : ${mail.from}`,
    `Sujet   : ${mail.subject}`,
    `Date    : ${mail.date}`,
    `Mots    : ${wordCount}`,
    ``,
    `## CC`,
    ccBlock,
    ``,
    `## CORPS DU MAIL`,
    truncated,
  ].join('\n');

  // Log diagnostique — prompt complet + meta du mail. Activable via
  // CHECK_MAILS_VERBOSE=1 (en prod, garde uniquement les versions
  // résumées pour ne pas saturer Vercel runtime logs).
  const verbose = process.env.CHECK_MAILS_VERBOSE === '1';
  if (verbose) {
    console.info('[analyzeMailWithClaude] prompt full', {
      from: mail.from,
      subject: mail.subject,
      cc_pairs_count: ccPairs.length,
      body_chars: truncated.length,
      word_count: wordCount,
      system_chars: systemPrompt.length,
      user_chars: userMessage.length,
      system: systemPrompt,
      prompt: userMessage,
    });
  } else {
    console.info('[analyzeMailWithClaude] prompt summary', {
      from: mail.from,
      subject: mail.subject,
      cc_pairs_count: ccPairs.length,
      cc_preview: ccBlock.slice(0, 300),
      body_chars: truncated.length,
      word_count: wordCount,
      system_chars: systemPrompt.length,
      user_chars: userMessage.length,
    });
  }

  // TODO observabilité (chantier 1) : intervention_id reste null dans
  // agent_logs pour les appels initiés par ce cron, car le matching
  // dossier est fait par le caller (createInterventionFromMail) APRÈS
  // le retour de cette fonction. Pour rétro-lier l'agent_log à
  // l'intervention créée, deux options à arbitrer dans un mini-sprint
  // ultérieur : (a) UPDATE agent_logs.intervention_id à la création
  // de l'intervention, (b) restructurer pour que le matching ait lieu
  // avant runAgent (cf. CAS A dans analyse-deep/route.ts).
  let parsed: Partial<CronMailAnalysis>;
  try {
    const result = await runAgent<Partial<CronMailAnalysis>>({
      agentName: 'triage_mail',
      model: MODEL,
      interventionId: null,
      emailId: null,
      inputSummary: {
        from_domain: mail.from?.match(/@([^>\s]+)/)?.[1] ?? null,
        subject_length: mail.subject?.length ?? 0,
        body_length: truncated.length,
        cc_count: ccPairs.length,
        word_count: wordCount,
      },
      run: async () => {
        // timeout SDK (vrai abort, pas Promise.race) — sinon défaut 600s.
        const client = new Anthropic({ apiKey, timeout: CLAUDE_TIMEOUT_MS });
        const msg = await client.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          temperature: 0,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        });
        const block = msg.content[0];
        const rawText = block && block.type === 'text' ? block.text : '';
        const stopReason = msg.stop_reason ?? null;

        console.error('[analyzeMailWithClaude] claude raw response', {
          raw_chars: rawText.length,
          stop_reason: stopReason,
          raw_preview: rawText.slice(0, 1500),
          truncated: stopReason === 'max_tokens',
        });

        const parsedRaw = tryParseJson(rawText);
        if (!parsedRaw) {
          console.error('[analyzeMailWithClaude] JSON parse failed', {
            stop_reason: stopReason,
            raw_chars: rawText.length,
            raw_full: rawText,
          });
          const tail = rawText.slice(-200).replace(/\s+/g, ' ').trim();
          const head = rawText.slice(0, 200).replace(/\s+/g, ' ').trim();
          const reason = stopReason === 'max_tokens'
            ? 'tronquée (max_tokens atteint)'
            : 'non valide';
          const preview = rawText.slice(0, 200).replace(/\s+/g, ' ');
          throw new Error(`JSON parse: Réponse Claude ${reason}. Début: "${head}…" Fin: "…${tail}" (preview: ${preview})`);
        }

        return {
          message: msg,
          output: parsedRaw,
          outputSummary: {
            classified_type: (parsedRaw as { type_email?: unknown }).type_email ?? null,
            language_detected: (parsedRaw as { langue?: unknown }).langue ?? null,
            priorite: (parsedRaw as { priorite?: unknown }).priorite ?? null,
            est_demande: (parsedRaw as { est_demande_intervention?: unknown }).est_demande_intervention === true,
            occupants_count: Array.isArray((parsedRaw as { occupants?: unknown }).occupants)
              ? (parsedRaw as { occupants: unknown[] }).occupants.length : 0,
          },
        };
      },
    });
    parsed = result.output;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Erreur Anthropic.';
    // Préserve le contrat de retour historique : pour un JSON invalide on
    // strippe le préfixe "JSON parse: " et le suffix "(preview: …)" pour
    // garder le message diagnostic (Début/Fin/raison) tel que connu côté
    // caller. Sinon (erreur SDK Anthropic), on renvoie le message brut.
    if (errMsg.startsWith('JSON parse:')) {
      const stripped = errMsg
        .replace(/^JSON parse:\s*/, '')
        .replace(/\s*\(preview: .*\)$/, '');
      return { ok: false, error: stripped };
    }
    console.error('[analyzeMailWithClaude] anthropic threw', err);
    return { ok: false, error: errMsg };
  }
  console.info('[analyzeMailWithClaude] parsed JSON', {
    est_demande: (parsed as { est_demande_intervention?: unknown }).est_demande_intervention,
    occupants_count: Array.isArray((parsed as { occupants?: unknown }).occupants)
      ? (parsed as { occupants: unknown[] }).occupants.length : 0,
    occupants_raw: (parsed as { occupants?: unknown }).occupants,
  });

  // ── Helpers d'extraction sécurisés ─────────────────────────────────
  function strOrEmpty(v: unknown): string {
    return typeof v === 'string' ? v.trim() : '';
  }
  function strOrNull(v: unknown): string | null {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    return t ? t : null;
  }
  function getObj(parent: unknown, key: string): Record<string, unknown> | null {
    if (!parent || typeof parent !== 'object') return null;
    const v = (parent as Record<string, unknown>)[key];
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
  }
  function strArray(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v
      .map((x) => (typeof x === 'string' ? x.trim() : ''))
      .filter((x): x is string => Boolean(x));
  }

  // ── demandeur (objet nested) ──────────────────────────────────────
  const dem = getObj(parsed, 'demandeur');
  const td = dem ? dem.type : (parsed as { type_demandeur?: unknown }).type_demandeur;
  const typeDemandeur: CronDemandeurType | null =
    td === 'syndic' || td === 'courtier' || td === 'particulier' ? td : null;
  const nom_societe = dem
    ? strOrNull(dem.nom_societe)
    : strOrNull((parsed as { nom_societe?: unknown }).nom_societe);

  // Contacts[] (nouveau format) — array de gestionnaires/délégués.
  // Rétrocompat : si seul nom_contact/email_contact/telephone_contact
  // (ancien format) est fourni, on construit un array d'1 élément.
  const contactsRaw = dem ? dem.contacts : null;
  const contacts: CronDemandeurContact[] = [];
  if (Array.isArray(contactsRaw)) {
    for (const c of contactsRaw) {
      if (!c || typeof c !== 'object') continue;
      const r = c as Record<string, unknown>;
      const nom = strOrEmpty(r.nom);
      const prenom = strOrEmpty(r.prenom);
      const email = strOrEmpty(r.email);
      const telephone = strOrEmpty(r.telephone);
      const est_principal = r.est_principal === true;
      if (!nom && !prenom && !email && !telephone) continue;
      contacts.push({ nom, prenom, email, telephone, est_principal });
    }
  } else if (dem) {
    // Fallback ancien format (nom_contact/email_contact/telephone_contact)
    const oldNom = strOrEmpty(dem.nom_contact);
    const oldEmail = strOrEmpty(dem.email_contact);
    const oldTel = strOrEmpty(dem.telephone_contact);
    if (oldNom || oldEmail || oldTel) {
      const split = splitName(oldNom);
      contacts.push({
        nom: split.nom || oldNom,
        prenom: split.prenom,
        email: oldEmail,
        telephone: oldTel,
        est_principal: true,
      });
    }
  }
  // Si aucun contact n'a été marqué principal, marque le premier
  if (contacts.length > 0 && !contacts.some((c) => c.est_principal)) {
    contacts[0].est_principal = true;
  }

  const principal = contacts.find((c) => c.est_principal) ?? contacts[0] ?? null;
  const dem_nom = principal ? `${principal.prenom} ${principal.nom}`.trim() || null : null;
  const dem_email = principal?.email || null;
  const dem_tel = principal?.telephone || null;

  // ── acp (objet nested) ────────────────────────────────────────────
  const acpObj = getObj(parsed, 'acp');
  const acp_nom = acpObj ? strOrNull(acpObj.nom) : strOrNull((parsed as { nom_immeuble?: unknown }).nom_immeuble);
  const acp_adresse_full = acpObj
    ? [acpObj.adresse, acpObj.code_postal, acpObj.ville].map(strOrEmpty).filter(Boolean).join(', ')
    : strOrEmpty((parsed as { adresse_immeuble?: unknown }).adresse_immeuble);
  const reference_sinistre = acpObj ? strOrNull(acpObj.reference_sinistre) : null;

  // ── intervention (objet nested) ───────────────────────────────────
  const ivObj = getObj(parsed, 'intervention');
  const type_probleme = ivObj
    ? strOrNull(ivObj.type_probleme)
    : strOrNull((parsed as { type_probleme?: unknown }).type_probleme);
  const description_precise = ivObj ? strOrNull(ivObj.description_precise) : null;
  const iv_priorite = ivObj?.priorite;
  const appartements_concernes = ivObj ? strArray(ivObj.appartements_concernes) : [];
  const zones_communes = ivObj ? strArray(ivObj.zones_communes) : [];

  // ── occupants (array — clé 'remarques' nouvelle, fallback 'notes') ─
  const occupantsRaw = Array.isArray((parsed as { occupants?: unknown }).occupants)
    ? ((parsed as { occupants: unknown[] }).occupants)
    : [];
  const occupants: CronExtractedOccupant[] = occupantsRaw
    .map((o): CronExtractedOccupant | null => {
      if (!o || typeof o !== 'object') return null;
      const r = o as Record<string, unknown>;
      const email = strOrEmpty(r.email);
      const tel = strOrEmpty(r.telephone);
      const apt = strOrEmpty(r.appartement);
      const etage = strOrEmpty(r.etage);
      const nom = strOrEmpty(r.nom);
      const prenom = strOrEmpty(r.prenom);
      const tRaw = typeof r.type === 'string' ? r.type : '';
      const type: CronOccupantType = ALLOWED_CRON_OCCUPANT_TYPES.has(tRaw as CronOccupantType)
        ? (tRaw as CronOccupantType)
        : 'occupant';
      // Le nouveau prompt utilise 'remarques' ; on accepte 'notes' aussi
      // par rétrocompat si jamais Claude rechute sur l'ancienne clé.
      const remarquesRaw = strOrEmpty(r.remarques) || strOrEmpty(r.notes);
      const notes = remarquesRaw.slice(0, 300);

      const hasContact = Boolean(email || tel);
      const hasZone = type === 'parties_communes' && (apt || nom);
      const hasIdentity = Boolean(nom || apt);
      // Filtre permissif : nom OU appartement suffit (cf. fix turn précédent)
      if (!hasContact && !hasZone && !hasIdentity) return null;

      return { prenom, nom, email, appartement: apt, etage, telephone: tel, type, notes };
    })
    .filter((x): x is CronExtractedOccupant => x !== null);

  // ── assurance (objet nested) ──────────────────────────────────────
  const assObj = getObj(parsed, 'assurance');
  let assurance: CronInsuranceExtracted | null = null;
  if (assObj) {
    const an = strOrNull(assObj.nom_contact);
    const ae = strOrNull(assObj.email);
    const at = strOrNull(assObj.telephone);
    const ap = strOrNull(assObj.reference_police);
    const asin = strOrNull(assObj.reference_sinistre);
    if (an || ae || at || ap || asin) {
      assurance = {
        nom_contact: an,
        email: ae,
        telephone: at,
        reference_sinistre: asin,
        reference_police: ap,
      };
    }
  }
  // Rétrocompat : ancienne version stockait reference_sinistre dans acp.
  // Si on n'a rien dans assurance.reference_sinistre, regarde acp.reference_sinistre.
  if (assurance && !assurance.reference_sinistre && acpObj) {
    const acpSin = strOrNull(acpObj.reference_sinistre);
    if (acpSin) assurance.reference_sinistre = acpSin;
  }

  // ── Délégué : reconstruit depuis demandeur.{nom_contact,email_contact} ─
  // Le nouveau prompt n'a plus de bloc 'delegue' séparé — c'est demandeur.nom_contact.
  // Fallback sur le From: si rien trouvé.
  let delegue: CronDelegueExtracted | null = null;
  if (dem_nom || dem_email || dem_tel) {
    const split = splitName(dem_nom);
    delegue = {
      prenom: split.prenom || null,
      nom: split.nom || (dem_nom && !split.nom ? dem_nom : null),
      email: dem_email,
      telephone: dem_tel,
    };
  }
  if (!delegue) {
    const fromEmail = extractEmailAddr(mail.from);
    const fromNameMatch = mail.from.match(/^"?([^"<]+?)"?\s*<[^>]+>/);
    if (fromEmail) {
      const fromName = fromNameMatch ? fromNameMatch[1].trim() : '';
      const split = splitName(fromName);
      delegue = {
        prenom: split.prenom || null,
        nom: split.nom || null,
        email: fromEmail,
        telephone: null,
      };
    }
  }

  // ── Top-level fields ──────────────────────────────────────────────
  const teRaw = (parsed as { type_email?: unknown }).type_email;
  const validTypes: CronMailType[] = ['nouvelle_demande', 'suivi_dossier', 'confirmation_rdv', 'annulation', 'rapport_demande', 'assurance', 'autre'];
  const type_email: CronMailType | null = typeof teRaw === 'string' && (validTypes as string[]).includes(teRaw)
    ? (teRaw as CronMailType)
    : null;

  const topPriorite = (parsed as { priorite?: unknown }).priorite;
  const priorite: 'normale' | 'urgente' | null =
    iv_priorite === 'urgente' || iv_priorite === 'normale' ? iv_priorite
    : topPriorite === 'urgente' || topPriorite === 'normale' ? topPriorite
    : null;

  const langue = (parsed as { langue?: unknown }).langue;
  const langueOk: 'fr' | 'nl' | 'en' | null =
    langue === 'fr' || langue === 'nl' || langue === 'en' ? langue : null;

  // reference_externe : priorité = assurance.reference_sinistre >
  // legacy acp.reference_sinistre > top-level reference_externe.
  const reference_externe = (assurance?.reference_sinistre ?? null)
    ?? reference_sinistre
    ?? strOrNull((parsed as { reference_externe?: unknown }).reference_externe);

  // nom_client : composé depuis demandeur.nom_contact si particulier,
  // sinon nom_societe. Rétrocompat avec ancien champ nom_client si présent.
  const legacyNomClient = strOrNull((parsed as { nom_client?: unknown }).nom_client);
  const nom_client = legacyNomClient
    ?? (typeDemandeur === 'particulier' ? dem_nom : nom_societe);

  // adresse : adresse de l'ACP > legacy 'adresse'
  const legacyAdresse = strOrNull((parsed as { adresse?: unknown }).adresse);
  const adresse = (acp_adresse_full || null) ?? legacyAdresse;

  const analysis: CronMailAnalysis = {
    est_demande_intervention: parsed.est_demande_intervention === true,
    type_email,
    nom_client,
    adresse,
    type_probleme,
    telephone: dem_tel,
    email: dem_email,
    priorite,
    resume: strOrNull((parsed as { resume?: unknown }).resume),
    langue: langueOk,
    occupants,
    type_demandeur: typeDemandeur,
    nom_societe,
    nom_immeuble: acp_nom,
    adresse_immeuble: acp_adresse_full || null,
    reference_externe,
    delegue,
    description_precise,
    appartements_concernes,
    zones_communes,
    assurance,
    action_requise: strOrNull((parsed as { action_requise?: unknown }).action_requise),
    contacts,
  };

  // ── Filet de sécurité : croisement CC ↔ occupants côté code ────────
  // Même si on demande à Claude de faire le matching, il peut le rater.
  // Pour chaque occupant sans email, cherche un CC dont le nom d'affichage
  // ou l'email contient le nom de famille de l'occupant (case-insensitive).
  // Ne touche jamais à un occupant qui a déjà un email.
  const ccEnriched: { occupantIdx: number; from: string; matchedBy: 'name' | 'email' }[] = [];
  for (let i = 0; i < analysis.occupants.length; i++) {
    const occ = analysis.occupants[i];
    if (occ.email || !occ.nom) continue;
    const nomLc = occ.nom.toLowerCase().trim();
    if (nomLc.length < 3) continue; // évite les matches trop fragiles ("Mr", "K9")
    // Préfère un match par nom d'affichage, puis par email-local-part
    let pickedEmail: string | null = null;
    let matchedBy: 'name' | 'email' | null = null;
    for (const cc of ccPairs) {
      if (cc.name && cc.name.toLowerCase().includes(nomLc)) {
        pickedEmail = cc.email;
        matchedBy = 'name';
        break;
      }
    }
    if (!pickedEmail) {
      for (const cc of ccPairs) {
        const local = cc.email.split('@')[0]?.toLowerCase() ?? '';
        if (local.includes(nomLc)) {
          pickedEmail = cc.email;
          matchedBy = 'email';
          break;
        }
      }
    }
    if (pickedEmail && matchedBy) {
      analysis.occupants[i] = { ...occ, email: pickedEmail };
      ccEnriched.push({ occupantIdx: i, from: pickedEmail, matchedBy });
    }
  }
  if (ccEnriched.length > 0) {
    console.info('[analyzeMailWithClaude] CC ↔ occupants cross-ref', { enriched: ccEnriched });
  }

  const rawOccupantsCount = Array.isArray((parsed as { occupants?: unknown }).occupants)
    ? (parsed as { occupants: unknown[] }).occupants.length : 0;
  console.info('[analyzeMailWithClaude] post-filter', {
    occupants_kept: analysis.occupants.length,
    occupants_dropped: rawOccupantsCount - analysis.occupants.length,
    cc_enriched_count: ccEnriched.length,
    final_occupants: analysis.occupants.map((o) => ({
      apt: o.appartement, nom: o.nom, type: o.type,
      has_email: Boolean(o.email), has_tel: Boolean(o.telephone),
    })),
  });
  return { ok: true, analysis };
}

// ─── Matching org/client depuis l'analyse Claude ─────────────────────────
//
// Stratégie :
//   - Match par EMAIL exact (high confidence) → réutilise l'entrée
//   - Sinon, si nom_societe (org) ou prenom+nom (client) extrait par
//     Claude → CRÉE une nouvelle entrée (avec marqueur log)
//   - Sinon → laisse null (le drawer affichera "non identifié")
//
// On évite le matching par nom LIKE seul : trop de faux positifs avec
// les variations orthographiques. L'admin peut toujours associer
// manuellement depuis le drawer.

interface MatchedOrgResult { id: string; created: boolean }
interface MatchedClientResult { id: string; created: boolean }
interface MatchedDelegueResult { id: string; created: boolean }

// Match-or-create d'un délégué pour une organisation donnée. Le match se
// fait par (organisation_id, lower(email)) — un index UNIQUE existe sur
// cette paire (migration 2026-05-13_delegues.sql). Si le délégué existe
// mais sans nom/téléphone et qu'on a ces infos, on les complète.
export async function matchOrCreateDelegue(args: {
  organisation_id: string;
  email: string;
  prenom: string | null;
  nom: string | null;
  telephone: string | null;
}): Promise<MatchedDelegueResult | null> {
  if (!args.email) return null;
  const admin = createAdminClient();
  const { data: existing, error: lookupErr } = await admin
    .from('delegues')
    .select('id, prenom, nom, telephone')
    .eq('organisation_id', args.organisation_id)
    .ilike('email', args.email)
    .limit(1)
    .maybeSingle();
  if (lookupErr) {
    console.warn('[check-mails] delegue lookup failed:', lookupErr.message);
  }
  if (existing?.id) {
    // Patch non-destructif : remplit les champs vides côté DB
    const patch: Record<string, string> = {};
    if (!existing.prenom && args.prenom) patch.prenom = args.prenom;
    if (!existing.nom && args.nom) patch.nom = args.nom;
    if (!existing.telephone && args.telephone) patch.telephone = args.telephone;
    if (Object.keys(patch).length > 0) {
      const { error: patchErr } = await admin
        .from('delegues')
        .update(patch)
        .eq('id', existing.id);
      if (patchErr) console.warn('[check-mails] delegue patch failed:', patchErr.message);
    }
    return { id: existing.id as string, created: false };
  }
  const { data: created, error } = await admin
    .from('delegues')
    .insert({
      organisation_id: args.organisation_id,
      email: args.email,
      prenom: args.prenom,
      nom: args.nom,
      telephone: args.telephone,
      role: 'delegue',
      actif: true,
    })
    .select('id')
    .single();
  if (error || !created) {
    console.warn('[check-mails] delegue create failed:', error?.message);
    return null;
  }
  console.log('[check-mails] nouveau délégué créé :', { email: args.email, org: args.organisation_id });
  return { id: created.id as string, created: true };
}

// Seuils de la règle métier d'auto-association ACP. Doivent rester en
// phase avec le bandeau « ACP suggérée » du drawer (cf. InterventionsClient).
//   ≥ ACP_AUTO_THRESHOLD          → on lie automatiquement (acp_id)
//   ≥ ACP_SUGGESTION_THRESHOLD    → suggestion à confirmer (acp_suggestion)
//   <  ACP_SUGGESTION_THRESHOLD   → ni l'un ni l'autre
export const ACP_AUTO_THRESHOLD = 0.85;
export const ACP_SUGGESTION_THRESHOLD = 0.60;

export interface MatchAcpScored {
  acp_id: string;
  nom_acp: string;
  score: number;        // ∈ [0, 1]
}

// Calcule le meilleur match (Dice coefficient) entre `nom_immeuble`
// extrait par Claude et la liste des ACPs liées au syndic donné.
// Retourne le meilleur candidat avec son score, peu importe ce dernier
// — c'est au caller d'appliquer les seuils ACP_AUTO_THRESHOLD /
// ACP_SUGGESTION_THRESHOLD selon le contexte (auto-link vs suggestion).
export async function matchAcpWithScore(args: {
  organisation_id: string;
  nom_immeuble: string;
}): Promise<MatchAcpScored | null> {
  if (!args.nom_immeuble.trim() || !args.organisation_id) return null;
  const admin = createAdminClient();
  // Récupère toutes les ACPs du syndic (volume usuel < 200 par syndic)
  const { data, error } = await admin
    .from('acps')
    .select('id, nom')
    .or(`syndic_id.eq.${args.organisation_id},syndic_id_ref.eq.${args.organisation_id}`);
  if (error) {
    console.warn('[check-mails] acp lookup failed:', error.message);
    return null;
  }
  const candidates = ((data ?? []) as { id: string; nom: string | null }[])
    .filter((a) => a.nom && a.nom.trim().length > 0);
  if (candidates.length === 0) return null;

  const best = bestMatch(args.nom_immeuble, candidates, (c) => c.nom ?? '');
  if (!best) return null;
  return {
    acp_id: best.candidate.id,
    nom_acp: best.candidate.nom ?? '',
    score: best.score,
  };
}

// Match-or-create d'une ACP pour un syndic donné. Wrapper "auto-link only"
// autour de matchAcpWithScore : ne renvoie un id QUE si le score ≥
// ACP_AUTO_THRESHOLD (85 %). Pour les scores intermédiaires, c'est le
// caller (check-mails sur création d'intervention) qui stocke une
// acp_suggestion ; les autres callers (apply-reanalysis) restent en
// auto-link strict pour éviter d'écrire dans acp_id sans contrôle humain.
interface MatchedAcpResult { id: string; created: boolean; score: number }
export async function matchAcpForOrganisation(args: {
  organisation_id: string;
  nom_immeuble: string;
}): Promise<MatchedAcpResult | null> {
  const scored = await matchAcpWithScore(args);
  if (!scored) return null;
  if (scored.score < ACP_AUTO_THRESHOLD) return null;
  console.log('[check-mails] ACP matchée :', {
    nom_extrait: args.nom_immeuble,
    nom_acp: scored.nom_acp,
    id: scored.acp_id,
    score: scored.score.toFixed(2),
  });
  return { id: scored.acp_id, created: false, score: scored.score };
}

// ─── Détection de doublons / dossiers liés ──────────────────────────────
//
// Avant de créer une nouvelle intervention depuis un mail, on cherche
// un dossier existant qui correspond. Trois signaux à confiance haute :
//   1. reference_sinistre (assurance) identique → même_dossier (pas de fenêtre)
//   2. ACP identique + email occupant déjà connu + < 12 mois → suivi
//   3. ACP identique + un appartement_concerné en commun + < 12 mois → même_dossier
// Renvoie le 1er match trouvé (ou null), avec son type_lien.
//
// Fenêtre 12 mois alignée sur la détection de récidive du drawer Historique
// (cf. /api/admin/interventions/[id]/historique) : un dossier non résolu
// rouvert dans l'année doit être rattaché plutôt que dupliqué.

export type CronDoublonType = 'meme_dossier' | 'suivi' | 'doublon' | 'related';

export interface CronDoublonResult {
  intervention_id: string;
  ref: string | null;
  type_lien: CronDoublonType;
  reason: string;        // libellé humain pour les logs et la timeline
}

export async function detectDoublon(args: {
  acp_id: string | null;
  occupant_emails: string[];
  appartements_concernes: string[];
  reference_sinistre: string | null;
}): Promise<CronDoublonResult | null> {
  const admin = createAdminClient();
  // 1. Match par reference_sinistre — confiance maximale, pas de window
  if (args.reference_sinistre) {
    const { data } = await admin
      .from('interventions')
      .select('id, ref')
      .eq('reference_externe', args.reference_sinistre)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.id) {
      return {
        intervention_id: data.id as string,
        ref: (data.ref as string) ?? null,
        type_lien: 'meme_dossier',
        reason: `Référence sinistre identique : ${args.reference_sinistre}`,
      };
    }
  }

  // Fenêtre 12 mois (365j) pour les heuristiques ACP-based.
  const ACP_DEDUP_WINDOW_DAYS = 365;
  const since = new Date();
  since.setDate(since.getDate() - ACP_DEDUP_WINDOW_DAYS);
  const sinceIso = since.toISOString();

  if (args.acp_id) {
    // 2. ACP identique + email occupant connu + < 12 mois → suivi
    if (args.occupant_emails.length > 0) {
      const { data: ivs } = await admin
        .from('interventions')
        .select('id, ref, created_at')
        .eq('acp_id', args.acp_id)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false });
      const ivList = (ivs ?? []) as { id: string; ref: string | null; created_at: string }[];
      if (ivList.length > 0) {
        const ivIds = ivList.map((r) => r.id);
        const { data: matchOcc } = await admin
          .from('occupants')
          .select('intervention_id, email')
          .in('intervention_id', ivIds)
          .in('email', args.occupant_emails);
        const matchedIvId = ((matchOcc ?? []) as { intervention_id: string; email: string }[])[0]?.intervention_id;
        if (matchedIvId) {
          const matched = ivList.find((iv) => iv.id === matchedIvId);
          if (matched) {
            return {
              intervention_id: matched.id,
              ref: matched.ref,
              type_lien: 'suivi',
              reason: 'Même ACP + occupant déjà connu (< 12 mois)',
            };
          }
        }
      }
    }

    // 3. ACP identique + appartement commun + < 12 mois → meme_dossier
    if (args.appartements_concernes.length > 0) {
      // Postgres array overlap : column && '{val1,val2}'::text[]
      // PostgREST : .overlaps('appartements_concernes', [...])
      const { data: ivs, error: aptErr } = await admin
        .from('interventions')
        .select('id, ref, appartements_concernes, created_at')
        .eq('acp_id', args.acp_id)
        .gte('created_at', sinceIso)
        .overlaps('appartements_concernes', args.appartements_concernes)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!aptErr && ivs?.id) {
        const apts = Array.isArray(ivs.appartements_concernes) ? ivs.appartements_concernes : [];
        return {
          intervention_id: ivs.id as string,
          ref: (ivs.ref as string) ?? null,
          type_lien: 'meme_dossier',
          reason: `Même ACP + appartement(s) commun(s) (< 12 mois) : ${apts.join(', ')}`,
        };
      }
    }
  }

  return null;
}

// Crée le lien bidirectionnel A↔B dans intervention_liens.
// Idempotent : ON CONFLICT DO NOTHING via le UNIQUE de la table.
export async function createInterventionLien(args: {
  intervention_id: string;
  intervention_liee_id: string;
  type_lien: CronDoublonType;
  source: 'auto' | 'manuel';
  note: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  const rows = [
    {
      intervention_id: args.intervention_id,
      intervention_liee_id: args.intervention_liee_id,
      type_lien: args.type_lien,
      source: args.source,
      note: args.note,
    },
    {
      intervention_id: args.intervention_liee_id,
      intervention_liee_id: args.intervention_id,
      type_lien: args.type_lien,
      source: args.source,
      note: args.note,
    },
  ];
  const { error } = await admin.from('intervention_liens').insert(rows);
  if (error) {
    // 23505 = duplicate (le lien existe déjà) — silencieux
    const code = (error as { code?: string }).code;
    if (code !== '23505') {
      console.warn('[check-mails] intervention_liens insert failed:', error.message);
    }
  }
}

// Rattache un mail Gmail à une intervention (table intervention_mails).
// Utilisé quand on détecte un doublon (mail rattaché à l'existant) OU
// au moment de la création d'une nouvelle intervention (mail-source).
export async function recordInterventionMail(args: {
  intervention_id: string;
  gmail_message_id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string | null;
  type_mail: 'entrant' | 'suivi' | 'assurance' | 'confirmation' | 'annulation' | 'rapport_demande';
}): Promise<void> {
  const admin = createAdminClient();
  const fromEmail = extractEmailAddr(args.from) ?? args.from;
  const fromNameMatch = args.from.match(/^"?([^"<]+?)"?\s*<[^>]+>/);
  const fromName = fromNameMatch ? fromNameMatch[1].trim() : null;
  const dateIso = (() => {
    try { return new Date(args.date).toISOString(); } catch { return null; }
  })();
  const { error } = await admin.from('intervention_mails').insert({
    intervention_id: args.intervention_id,
    gmail_message_id: args.gmail_message_id,
    from_email: fromEmail,
    from_name: fromName,
    subject: args.subject,
    date: dateIso,
    snippet: args.snippet ?? null,
    type_mail: args.type_mail,
  });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code !== '23505') {
      // 42P01 = table absente → migration 2026-05-20 pas appliquée
      if (code !== '42P01') {
        console.warn('[check-mails] intervention_mails insert failed:', error.message);
      }
    }
  }
}

export async function matchOrCreateOrganisation(args: {
  type: 'syndic' | 'courtier';
  nomSociete: string | null;
  email: string;
  telephone: string;
}): Promise<MatchedOrgResult | null> {
  if (!args.email && !args.nomSociete) return null;
  const admin = createAdminClient();
  // 1. Match par email (high confidence)
  if (args.email) {
    const { data: byEmail } = await admin
      .from('organisations')
      .select('id')
      .ilike('email', args.email)
      .limit(1)
      .maybeSingle();
    if (byEmail?.id) return { id: byEmail.id as string, created: false };
  }
  // 2. Création — uniquement si on a un nom de société identifiable.
  // Sinon trop incertain → admin associera manuellement.
  if (!args.nomSociete) return null;
  const { data: created, error } = await admin
    .from('organisations')
    .insert({
      nom: args.nomSociete,
      type: args.type,
      email: args.email,
      telephone: args.telephone || null,
    })
    .select('id')
    .single();
  if (error || !created) {
    console.warn('[check-mails] org create failed:', error?.message);
    return null;
  }
  console.log('[check-mails] nouvelle organisation créée :', { type: args.type, nom: args.nomSociete });
  return { id: created.id as string, created: true };
}

export async function matchOrCreateClient(args: {
  prenom: string;
  nom: string;
  email: string;
  telephone: string;
  adresse: string | null;
}): Promise<MatchedClientResult | null> {
  if (!args.email && !args.nom && !args.prenom) return null;
  const admin = createAdminClient();
  // 1. Match par email
  if (args.email) {
    const { data: byEmail } = await admin
      .from('clients')
      .select('id')
      .ilike('email', args.email)
      .limit(1)
      .maybeSingle();
    if (byEmail?.id) return { id: byEmail.id as string, created: false };
  }
  // 2. Création
  if (!args.nom && !args.prenom) return null;
  const { data: created, error } = await admin
    .from('clients')
    .insert({
      type: 'particulier',
      nom: args.nom || args.prenom || 'Sans nom',
      prenom: args.prenom || null,
      email: args.email || null,
      telephone: args.telephone || null,
      adresse: args.adresse || null,
      actif: true,
    })
    .select('id')
    .single();
  if (error || !created) {
    console.warn('[check-mails] client create failed:', error?.message);
    return null;
  }
  console.log('[check-mails] nouveau client créé :', { nom: args.nom, prenom: args.prenom });
  return { id: created.id as string, created: true };
}

async function createInterventionFromMail(
  mail: { id: string; from: string; subject: string },
  analysis: CronMailAnalysis,
): Promise<{ ok: true; intervention_id: string; ref: string } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const ref = await nextRefForYear();
  const { prenom, nom } = splitName(analysis.nom_client);
  const emailAddr = analysis.email ?? extractEmailAddr(mail.from) ?? '';
  const tel = analysis.telephone ?? '';
  const adr = parseAdresse(analysis.adresse);

  const type = (ALLOWED_TYPES as readonly string[]).includes(analysis.type_probleme ?? '')
    ? analysis.type_probleme
    : 'Autre';
  const priorite = analysis.priorite ?? 'normale';

  const adresseFormatee = adr.rue
    ? [adr.rue, adr.cp, adr.ville].filter(Boolean).join(', ')
    : null;

  const nomComplet = (analysis.nom_client ?? `${prenom} ${nom}`.trim()) || '';
  const adresseIntervention = adresseFormatee ?? '';

  const particulierContact: Record<string, unknown> = {
    nom_complet: nomComplet,
    adresse_intervention: adresseIntervention,
    prenom,
    nom: nom || (analysis.nom_client ?? ''),
    email: emailAddr,
    telephone: tel,
    adresse: { rue: adr.rue, code_postal: adr.cp, ville: adr.ville },
    mandant: {
      prenom,
      nom: nom || (analysis.nom_client ?? ''),
      email: emailAddr,
      tel,
      adresse_facturation: { rue: adr.rue, code_postal: adr.cp, ville: adr.ville },
    },
    lieu: {
      meme_que_mandant: true,
      rue: adr.rue,
      cp: adr.cp,
      ville: adr.ville,
    },
    contact_sur_place: { actif: false },
    langue: analysis.langue,
    nom_immeuble: analysis.nom_immeuble ?? null,
  };
  // Bloc assureur — stocké dans particulier_contact pour rester
  // compatible (pas de nouvelle table). Lu par le drawer pour
  // afficher la section 🛡️ Assurance.
  if (analysis.assurance) {
    particulierContact.assureur = {
      nom: analysis.assurance.nom_contact,
      email: analysis.assurance.email,
      telephone: analysis.assurance.telephone,
      reference_police: analysis.assurance.reference_police,
    };
  }

  // Matching org/client/délégué/ACP selon type_demandeur
  let organisationId: string | null = null;
  let clientId: string | null = null;
  let delegueId: string | null = null;
  let acpId: string | null = null;
  // Suggestion intermédiaire (60-84 %) à présenter dans le drawer si on
  // n'a pas atteint le seuil d'auto-link.
  let acpSuggestion: { nom_extrait: string; acp_id_suggere: string; score: number } | null = null;
  if (analysis.type_demandeur === 'syndic' || analysis.type_demandeur === 'courtier') {
    const matched = await matchOrCreateOrganisation({
      type: analysis.type_demandeur,
      nomSociete: analysis.nom_societe,
      email: emailAddr,
      telephone: tel,
    });
    organisationId = matched?.id ?? null;

    // Délégué : la personne physique qui a envoyé le mail. Match par
    // (org_id, email). Email du délégué = celui extrait par Claude OU
    // l'email du sender en fallback.
    if (organisationId) {
      // Tous les contacts du syndic → delegues. Le 1er principal est
      // assigné à l'intervention (delegue_id). Les autres restent en DB
      // pour faciliter les futures attributions.
      const allContacts: CronDemandeurContact[] = analysis.contacts.length > 0
        ? analysis.contacts
        : [{
            nom: analysis.delegue?.nom ?? '',
            prenom: analysis.delegue?.prenom ?? '',
            email: analysis.delegue?.email ?? emailAddr,
            telephone: analysis.delegue?.telephone ?? tel ?? '',
            est_principal: true,
          }];
      let principalDelegueId: string | null = null;
      for (const c of allContacts) {
        if (!c.email) continue;
        const matched = await matchOrCreateDelegue({
          organisation_id: organisationId,
          email: c.email,
          prenom: c.prenom || null,
          nom: c.nom || null,
          telephone: c.telephone || null,
        });
        if (!matched) continue;
        if (c.est_principal && !principalDelegueId) {
          principalDelegueId = matched.id;
        }
        // Marque est_contact_principal en DB pour le principal
        if (c.est_principal) {
          try {
            await admin
              .from('delegues')
              .update({ est_contact_principal: true })
              .eq('id', matched.id);
          } catch { /* migration 2026-05-20 peut être pending */ }
        }
      }
      delegueId = principalDelegueId;

      // ACP : matching par score Dice sur les ACPs du syndic.
      //   ≥ 85 % → auto-link (acp_id)
      //   60-84 % → suggestion à confirmer (acp_suggestion, acp_id reste null)
      //   < 60 % → rien
      if (analysis.nom_immeuble) {
        const acpMatch = await matchAcpWithScore({
          organisation_id: organisationId,
          nom_immeuble: analysis.nom_immeuble,
        });
        if (acpMatch && acpMatch.score >= ACP_AUTO_THRESHOLD) {
          acpId = acpMatch.acp_id;
          console.log('[check-mails] ACP auto-liée :', {
            nom_extrait: analysis.nom_immeuble,
            nom_acp: acpMatch.nom_acp,
            score: acpMatch.score.toFixed(2),
          });
        } else if (acpMatch && acpMatch.score >= ACP_SUGGESTION_THRESHOLD) {
          acpSuggestion = {
            nom_extrait: analysis.nom_immeuble,
            acp_id_suggere: acpMatch.acp_id,
            score: Math.round(acpMatch.score * 100) / 100,
          };
          console.log('[check-mails] ACP suggérée :', {
            nom_extrait: analysis.nom_immeuble,
            nom_acp: acpMatch.nom_acp,
            score: acpMatch.score.toFixed(2),
          });
        }
      }
    }
  } else if (analysis.type_demandeur === 'particulier') {
    const matched = await matchOrCreateClient({
      prenom, nom, email: emailAddr, telephone: tel,
      adresse: adresseFormatee,
    });
    clientId = matched?.id ?? null;
  }

  // demandeur_type sur l'intervention : on garde 'particulier' pour
  // syndic/courtier aussi, parce que le schéma actuel impose syndic OU
  // particulier (pas de courtier comme valeur), et que particulier_contact
  // contient déjà mandant/lieu. L'org/client_id sert de lien externe.
  const demandeurType = 'particulier';

  // ── Détection de doublon AVANT création ────────────────────────────
  // Si on trouve un dossier existant qui correspond, on rattache le mail
  // (intervention_mails) et on log dans la timeline — pas de nouvelle
  // intervention créée.
  const occupantEmails = analysis.occupants
    .map((o) => o.email.trim().toLowerCase())
    .filter(Boolean);
  let doublon: CronDoublonResult | null = null;
  try {
    doublon = await detectDoublon({
      acp_id: acpId,
      occupant_emails: occupantEmails,
      appartements_concernes: analysis.appartements_concernes,
      reference_sinistre: analysis.assurance?.reference_sinistre ?? analysis.reference_externe ?? null,
    });
  } catch (e) {
    console.warn('[check-mails] detectDoublon threw:', e);
  }
  if (doublon) {
    console.log('[check-mails] doublon détecté — rattachement', {
      target: doublon.intervention_id,
      ref: doublon.ref,
      type_lien: doublon.type_lien,
      reason: doublon.reason,
    });
    // Détermine le type_mail à enregistrer selon analysis.type_email
    const typeMail: 'entrant' | 'suivi' | 'assurance' | 'confirmation' | 'annulation' | 'rapport_demande' =
      analysis.type_email === 'assurance' ? 'assurance'
      : analysis.type_email === 'confirmation_rdv' ? 'confirmation'
      : analysis.type_email === 'annulation' ? 'annulation'
      : analysis.type_email === 'rapport_demande' ? 'rapport_demande'
      : analysis.type_email === 'suivi_dossier' ? 'suivi'
      : 'entrant';
    await recordInterventionMail({
      intervention_id: doublon.intervention_id,
      gmail_message_id: mail.id,
      from: mail.from,
      subject: mail.subject,
      date: new Date().toISOString(),
      snippet: analysis.resume ?? null,
      type_mail: typeMail,
    });
    // Timeline
    try {
      await admin.from('intervention_timeline').insert({
        intervention_id: doublon.intervention_id,
        type: 'mail_lie',
        message: `📧 Mail lié automatiquement (${doublon.type_lien}) — ${mail.from} — ${mail.subject}`,
        payload: { mail_id: mail.id, reason: doublon.reason, analysis },
        created_by: 'cron:check-mails',
      });
    } catch { /* noop */ }
    // Update assureur sur l'intervention existante si on a de nouvelles infos
    if (analysis.assurance) {
      try {
        await admin
          .from('interventions')
          .update({ assureur: analysis.assurance, updated_at: new Date().toISOString() })
          .eq('id', doublon.intervention_id);
      } catch { /* migration 2026-05-20 peut être pending */ }
    }
    // Renvoie l'intervention existante — pas de nouvelle création.
    return { ok: true, intervention_id: doublon.intervention_id, ref: doublon.ref ?? '' };
  }

  // Description : préfère description_precise (nouveau prompt FoxO) ;
  // sinon resume ; sinon fallback sujet. Si aucun occupant n'est extrait
  // mais que des appartements/zones communes sont mentionnés, on les
  // append à la description pour ne pas perdre l'info terrain.
  const baseDesc = analysis.description_precise
    ?? analysis.resume
    ?? `(extrait par IA — sujet : ${mail.subject})`;
  let description = baseDesc;
  if (analysis.occupants.length === 0) {
    const appList = analysis.appartements_concernes?.join(', ') || '';
    const zoneList = analysis.zones_communes?.join(', ') || '';
    const extras: string[] = [];
    if (appList) extras.push(`Appartements concernés : ${appList}`);
    if (zoneList) extras.push(`Zones communes : ${zoneList}`);
    if (extras.length > 0) description = `${baseDesc}\n\n${extras.join('\n')}`;
  }

  // Insert intervention. Si la migration 2026-05-17 (delegue_id) n'est
  // pas encore appliquée en prod, l'insert échoue avec 42703 sur la
  // colonne delegue_id — on retombe sur un insert sans cette colonne.
  const baseIvPayload: Record<string, unknown> = {
    ref,
    statut: 'nouvelle',
    priorite,
    type,
    description,
    adresse: adresseFormatee,
    date_demande: new Date().toISOString().slice(0, 10),
    demandeur_type: demandeurType,
    particulier_contact: particulierContact,
    source: 'mail',
    source_mail_id: mail.id,
    reference_externe: analysis.reference_externe ?? null,
    organisation_id: organisationId,
    client_id: clientId,
    acp_id: acpId,
    // Suggestion ACP (migration 2026-05-26). Posée uniquement quand le
    // score est intermédiaire (60-84 %) et qu'acp_id est resté null —
    // l'admin valide depuis le drawer Dossier.
    acp_suggestion: acpSuggestion,
    // Nouvelles colonnes (migration 2026-05-20). Si absentes, l'auto-strip
    // cascade les retire à l'insert.
    action_requise: analysis.action_requise ?? null,
    assureur: analysis.assurance ?? null,
    appartements_concernes: analysis.appartements_concernes.length > 0
      ? analysis.appartements_concernes
      : null,
  };
  // notes_tech : on y stocke action_requise (si extrait) — visible côté
  // drawer comme bandeau 📋 Action requise. Si la migration 2026-05-19
  // n'est pas appliquée, le retry plus bas strippe cette colonne.
  if (analysis.action_requise) {
    baseIvPayload.notes_tech = `[IA action requise] ${analysis.action_requise}`;
  }
  const fullIvPayload: Record<string, unknown> = { ...baseIvPayload, delegue_id: delegueId };

  // Insert avec auto-strip cascade : si une colonne manque (migration
  // pending), on parse le nom dans le message d'erreur 42703 et on
  // retire cette colonne précisément, puis on retente. Évite de devoir
  // hardcoder chaque migration future.
  let iv: { id: string; ref: string } | null = null;
  let insertErr: { code?: string; message: string } | null = null;
  let workingPayload: Record<string, unknown> = { ...fullIvPayload };
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await admin
      .from('interventions')
      .insert(workingPayload)
      .select('id, ref')
      .single();
    if (data && !error) {
      iv = { id: data.id as string, ref: data.ref as string };
      break;
    }
    insertErr = error ? { code: (error as { code?: string }).code, message: error.message } : null;
    const colMissing = insertErr?.code === '42703'
      || insertErr?.code === 'PGRST204'
      || /column .* does not exist/i.test(insertErr?.message ?? '')
      || /Could not find the .* column/i.test(insertErr?.message ?? '');
    if (!colMissing) break;
    // Parse le nom de la colonne manquante (Postgres natif OU PostgREST cache)
    const missingCol = parseMissingColumn(insertErr?.message ?? '');
    if (!missingCol || !(missingCol in workingPayload)) {
      console.warn('[check-mails] colonne 42703 non parsable, abandon insert');
      break;
    }
    console.warn(`[check-mails] interventions.${missingCol} absent — strip et retry (apply la migration correspondante)`);
    const stripped: Record<string, unknown> = { ...workingPayload };
    delete stripped[missingCol];
    workingPayload = stripped;
  }
  if (!iv) return { ok: false, error: insertErr?.message ?? 'Insert failed' };

  // Timeline
  try {
    await admin.from('intervention_timeline').insert({
      intervention_id: iv.id,
      type: 'creation_mail',
      message: 'Demande reçue par mail — analysée par IA',
      payload: { mail_id: mail.id, from: mail.from, subject: mail.subject, analysis },
      created_by: 'cron:check-mails',
    });
  } catch (e) {
    console.warn('[check-mails] timeline insert skipped:', e);
  }

  // Rattache le mail-source à l'intervention (migration 2026-05-20).
  // Best-effort : la fonction noop si la table n'existe pas (42P01).
  await recordInterventionMail({
    intervention_id: iv.id,
    gmail_message_id: mail.id,
    from: mail.from,
    subject: mail.subject,
    date: new Date().toISOString(),
    snippet: analysis.resume ?? null,
    type_mail: 'entrant',
  });

  // Création automatique des occupants extraits.
  // - contact_preference : email si email présent, sinon sms si tel,
  //   sinon email par défaut.
  // - parties_communes : pas de filtre email/tel (zone sans contact).
  // - instructions : "[extrait du mail]" + notes spécifiques (état apt,
  //   actions déjà prises) renvoyées par Claude.
  const occupantsToInsertFull: OccupantInsertRow[] = (analysis.occupants ?? [])
    .filter((o) => o.type === 'parties_communes' || o.email || o.telephone)
    .map((o) => {
      const baseMarker = '[extrait du mail]';
      const instructions = o.notes
        ? `${baseMarker} ${o.notes}`
        : baseMarker;
      const contactPref: 'email' | 'sms' = o.email ? 'email' : (o.telephone ? 'sms' : 'email');
      return {
        intervention_id: iv.id,
        appartement: o.appartement || null,
        etage: o.etage || null,
        prenom: o.prenom || null,
        nom: o.nom || (o.type === 'parties_communes' ? 'Parties communes' : null),
        email: o.email || null,
        telephone: o.telephone || null,
        conf: 'en_attente' as const,
        contact_preference: contactPref,
        instructions,
        type_occupant: o.type,
      };
    });
  if (occupantsToInsertFull.length > 0) {
    const insertRes = await safeInsertOccupants(occupantsToInsertFull);
    if (!insertRes.ok) {
      console.warn('[check-mails] occupants insert failed', {
        intervention_id: iv.id,
        error: insertRes.error,
        code: insertRes.code,
        stripped_columns: insertRes.stripped_columns,
      });
    }
  }

  return { ok: true, intervention_id: iv.id as string, ref: iv.ref as string };
}

// Insert occupants avec auto-strip cascade de toute colonne signalée
// "does not exist" (code 42703). Évite d'avoir à hardcoder chaque
// migration pending — on parse le nom de la colonne dans le message
// d'erreur, on la retire de toutes les rows, et on retente. Boucle
// jusqu'à 6 fois max (sécurité anti-infini).
//
// Renvoie un résultat structuré : la route appelante peut alors logger
// l'échec et propager l'erreur côté UI au lieu de prétendre que tout
// est ok.
export type OccupantInsertRow = {
  intervention_id: string;
  appartement: string | null;
  etage: string | null;
  prenom: string | null;
  nom: string | null;
  email: string | null;
  telephone: string | null;
  conf: 'en_attente';
  contact_preference: 'email' | 'sms' | 'whatsapp' | 'both';
  instructions: string;
  type_occupant: CronOccupantType;
};

export type SafeInsertOccupantsResult =
  | { ok: true; inserted: number; stripped_columns: string[] }
  | { ok: false; error: string; code: string | null; details: string | null; hint: string | null; stripped_columns: string[] };

// Extrait le nom de la colonne mentionnée dans une erreur DB. Gère :
//
//  Postgres (code 42703) :
//    "column \"foo\" of relation \"occupants\" does not exist"
//    "column foo does not exist"
//
//  PostgREST schema cache (code PGRST204) — l'API n'envoie même pas le
//  SQL au DB parce que sa cache du schéma ignore la colonne :
//    "Could not find the 'foo' column of 'occupants' in the schema cache"
//    "Could not find the foo column..."
//
// Sans gérer PGRST204, l'auto-strip cascade ne s'enclenche jamais
// quand une colonne manque côté API (comme c'est arrivé pour
// `instructions` après une migration partielle).
function parseMissingColumn(message: string): string | null {
  // Postgres natif
  const m1 = message.match(/column\s+(?:"|')?([a-z_][a-z0-9_]*)(?:"|')?\s+of\s+relation/i);
  if (m1) return m1[1];
  const m2 = message.match(/column\s+(?:"|')?([a-z_][a-z0-9_]*)(?:"|')?\s+does not exist/i);
  if (m2) return m2[1];
  const m3 = message.match(/(?:^|\s)([a-z_][a-z0-9_]*)\s+does not exist/i);
  if (m3) return m3[1];
  // PostgREST schema cache (PGRST204)
  const m4 = message.match(/Could not find the\s+(?:"|')?([a-z_][a-z0-9_]*)(?:"|')?\s+column/i);
  if (m4) return m4[1];
  return null;
}

export async function safeInsertOccupants(rows: OccupantInsertRow[]): Promise<SafeInsertOccupantsResult> {
  const admin = createAdminClient();
  const strippedColumns: string[] = [];
  let workingRows: Record<string, unknown>[] = rows.map((r) => ({ ...r }));

  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const { data, error } = await admin
        .from('occupants')
        .insert(workingRows)
        .select('id');
      console.error('[safeInsertOccupants] result', {
        attempt,
        rows_count: workingRows.length,
        first_row_keys: workingRows[0] ? Object.keys(workingRows[0]) : [],
        stripped_so_far: strippedColumns,
        data_count: Array.isArray(data) ? data.length : null,
        error: error ? {
          code: (error as { code?: string }).code ?? null,
          message: error.message,
          details: (error as { details?: string }).details ?? null,
          hint: (error as { hint?: string }).hint ?? null,
        } : null,
      });

      if (!error) {
        return {
          ok: true,
          inserted: Array.isArray(data) ? data.length : workingRows.length,
          stripped_columns: strippedColumns,
        };
      }

      const code = (error as { code?: string }).code ?? null;
      // 42703 = Postgres "column does not exist"
      // PGRST204 = PostgREST "schema cache" (colonne pas re-scannée
      //   après ALTER TABLE — frequent en prod après une migration)
      const colMissing = code === '42703'
        || code === 'PGRST204'
        || /column .* does not exist/i.test(error.message)
        || /Could not find the .* column/i.test(error.message);
      if (!colMissing) {
        return {
          ok: false,
          error: error.message,
          code,
          details: (error as { details?: string }).details ?? null,
          hint: (error as { hint?: string }).hint ?? null,
          stripped_columns: strippedColumns,
        };
      }

      const colName = parseMissingColumn(error.message)
        ?? parseMissingColumn((error as { details?: string }).details ?? '');
      if (!colName) {
        return {
          ok: false,
          error: `column missing but name unparsable: ${error.message}`,
          code,
          details: (error as { details?: string }).details ?? null,
          hint: (error as { hint?: string }).hint ?? null,
          stripped_columns: strippedColumns,
        };
      }
      console.warn(`[safeInsertOccupants] colonne '${colName}' absente — strip et retry`);
      strippedColumns.push(colName);
      workingRows = workingRows.map((r) => {
        const copy: Record<string, unknown> = { ...r };
        delete copy[colName];
        return copy;
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erreur inconnue';
      console.error('[safeInsertOccupants] threw', { attempt, message: msg });
      return { ok: false, error: msg, code: null, details: null, hint: null, stripped_columns: strippedColumns };
    }
  }

  return {
    ok: false,
    error: 'Trop de colonnes manquantes (6 strip successifs). Vérifie que la table occupants existe et a les colonnes de base.',
    code: null,
    details: null,
    hint: null,
    stripped_columns: strippedColumns,
  };
}

async function logMailEntry(args: {
  mail_id: string;
  from: string;
  subject: string;
  action: string;
  intervention_id?: string;
  error?: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from('sms_logs').insert({
      intervention_id: args.intervention_id ?? null,
      to_phone: extractEmailAddr(args.from) ?? args.from,
      channel: 'email',
      type: 'mail_entrant',
      message: `[${args.action}] ${args.subject}`,
      status: args.error ? 'failed' : 'sent',
      error: args.error ?? null,
      cost_estimate_eur: 0,
      sent_by: 'cron:check-mails',
      twilio_sid: args.mail_id,    // on stocke le mail_id ici pour pouvoir tracer
    });
  } catch { /* noop */ }
}

async function updateLastCheck(): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin
      .from('parametres')
      .upsert(
        { cle: 'mail_last_check', valeur: new Date().toISOString(), updated_at: new Date().toISOString() },
        { onConflict: 'cle' },
      );
  } catch (e) {
    console.warn('[check-mails] mail_last_check update failed:', e);
  }
}

async function alreadyConvertedMail(mailId: string): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from('interventions')
      .select('id')
      .eq('source_mail_id', mailId)
      .limit(1)
      .maybeSingle();
    return Boolean(data);
  } catch {
    return false;
  }
}

export async function runCheckMails(dryRun: boolean): Promise<CronMailResult> {
  const t0 = Date.now();
  console.log('[check-mails] start', { dryRun });

  const result: CronMailResult = {
    processed: 0, created: 0, labeled_lu: 0, skipped: 0, errors: 0, items: [],
  };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    result.errors++;
    result.items.push({ mail_id: '', from: '', subject: '', action: 'error', error: 'ANTHROPIC_API_KEY manquante' });
    return result;
  }

  // Filtre Gmail : non lus, pas déjà traités, pas déjà labelisés "lu non-demande"
  const q = 'in:inbox is:unread -label:FOXO_TRAITE -label:FOXO_LU';
  let list: Awaited<ReturnType<typeof listInboxMails>>;
  try {
    list = await withTimeout(
      listInboxMails({ limit: MAX_MAILS_PER_RUN, q }),
      GMAIL_TIMEOUT_MS,
      'listInboxMails',
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur listInboxMails';
    console.error('[check-mails] list timeout/error', msg);
    result.errors++;
    result.items.push({ mail_id: '', from: '', subject: '', action: 'error', error: msg });
    return result;
  }
  if (!list.ok) {
    console.error('[check-mails] list ko', list.error);
    result.errors++;
    result.items.push({ mail_id: '', from: '', subject: '', action: 'error', error: list.error });
    return result;
  }
  console.log('[check-mails] list', { count: list.mails.length });
  if (list.mails.length === 0) {
    if (!dryRun) await updateLastCheck();
    console.log('[check-mails] done', { elapsed_ms: Date.now() - t0, ...result });
    return result;
  }

  for (let i = 0; i < list.mails.length; i++) {
    const m = list.mails[i];
    console.log('[check-mails] mail', { idx: i + 1, total: list.mails.length, id: m.id, from: m.from });
    result.processed++;
    try {
      // Dédup côté DB : si on a déjà créé une intervention pour ce
      // mail_id (label Gmail perdu, p. ex.), on ne refait pas le boulot.
      if (await alreadyConvertedMail(m.id)) {
        result.skipped++;
        result.items.push({ mail_id: m.id, from: m.from, subject: m.subject, action: 'skipped' });
        continue;
      }

      const detailRes = await withTimeout(getMailDetail(m.id), GMAIL_TIMEOUT_MS, `getMailDetail:${m.id}`);
      if (!detailRes.ok) {
        result.errors++;
        result.items.push({ mail_id: m.id, from: m.from, subject: m.subject, action: 'error', error: detailRes.error });
        if (!dryRun) await logMailEntry({ mail_id: m.id, from: m.from, subject: m.subject, action: 'error', error: detailRes.error });
        continue;
      }

      // analyzeMailWithClaude porte déjà son timeout SDK (CLAUDE_TIMEOUT_MS)
      const analyzeRes = await analyzeMailWithClaude(apiKey, {
        from: detailRes.mail.from,
        subject: detailRes.mail.subject,
        date: detailRes.mail.date,
        cc: detailRes.mail.cc,
        body_text: detailRes.mail.body_text,
        body_html: detailRes.mail.body_html,
      });
      if (!analyzeRes.ok) {
        result.errors++;
        result.items.push({ mail_id: m.id, from: m.from, subject: m.subject, action: 'error', error: analyzeRes.error });
        if (!dryRun) await logMailEntry({ mail_id: m.id, from: m.from, subject: m.subject, action: 'error', error: analyzeRes.error });
        continue;
      }
      const analysis = analyzeRes.analysis;

      if (dryRun) {
        result.items.push({
          mail_id: m.id,
          from: m.from,
          subject: m.subject,
          action: analysis.est_demande_intervention ? 'created_intervention' : 'labeled_lu',
          analysis,
        });
        if (analysis.est_demande_intervention) result.created++;
        else result.labeled_lu++;
        continue;
      }

      if (analysis.est_demande_intervention) {
        // createInterventionFromMail enchaîne N round-trips DB séquentiels
        // (match org/délégué/acp/client, detectDoublon, insert intervention
        // retry ×5, safeInsertOccupants retry ×6) sans abort natif. On le
        // borne via withTimeout : sur dépassement, withTimeout rejette
        // `Timeout 30000ms: createInterventionFromMail`.
        let createRes: Awaited<ReturnType<typeof createInterventionFromMail>>;
        try {
          createRes = await withTimeout(
            createInterventionFromMail(
              { id: m.id, from: m.from, subject: m.subject },
              analysis,
            ),
            DB_TIMEOUT_MS,
            'createInterventionFromMail',
          );
        } catch (e) {
          // Deux cas, même issue : on `continue` SANS appeler addLabelToMail,
          // donc le mail n'est PAS labellisé FOXO_TRAITE et reste is:unread →
          // requalifié naturellement au prochain run. On distingue le timeout
          // (message normalisé 'createInterventionFromMail timeout') d'une
          // exception DB inattendue, uniquement pour le niveau de log.
          const isTimeout = e instanceof Error
            && e.message === `Timeout ${DB_TIMEOUT_MS}ms: createInterventionFromMail`;
          const errMsg = isTimeout
            ? 'createInterventionFromMail timeout'
            : (e instanceof Error ? e.message : 'Erreur createInterventionFromMail');
          if (isTimeout) {
            console.error('[check-mails] createInterventionFromMail TIMEOUT — mail non labellisé, repris au prochain run', { id: m.id, ms: DB_TIMEOUT_MS });
          } else {
            console.error('[check-mails] createInterventionFromMail threw', { id: m.id, msg: errMsg });
          }
          result.errors++;
          result.items.push({ mail_id: m.id, from: m.from, subject: m.subject, action: 'error', error: errMsg });
          await logMailEntry({ mail_id: m.id, from: m.from, subject: m.subject, action: 'error', error: errMsg });
          continue;
        }
        if (!createRes.ok) {
          result.errors++;
          result.items.push({ mail_id: m.id, from: m.from, subject: m.subject, action: 'error', error: createRes.error });
          await logMailEntry({ mail_id: m.id, from: m.from, subject: m.subject, action: 'error', error: createRes.error });
          continue;
        }
        await withTimeout(
          addLabelToMail({ mailId: m.id, labelName: 'FOXO_TRAITE', removeUnread: true }),
          GMAIL_TIMEOUT_MS,
          `addLabel:FOXO_TRAITE:${m.id}`,
        );
        await logMailEntry({
          mail_id: m.id, from: m.from, subject: m.subject,
          action: 'created_intervention',
          intervention_id: createRes.intervention_id,
        });
        result.created++;
        result.items.push({
          mail_id: m.id, from: m.from, subject: m.subject,
          action: 'created_intervention',
          intervention_id: createRes.intervention_id,
          ref: createRes.ref,
          analysis,
        });
      } else {
        await withTimeout(
          addLabelToMail({ mailId: m.id, labelName: 'FOXO_LU', removeUnread: true }),
          GMAIL_TIMEOUT_MS,
          `addLabel:FOXO_LU:${m.id}`,
        );
        await logMailEntry({ mail_id: m.id, from: m.from, subject: m.subject, action: 'labeled_lu' });
        result.labeled_lu++;
        result.items.push({
          mail_id: m.id, from: m.from, subject: m.subject,
          action: 'labeled_lu',
          analysis,
        });
      }
    } catch (e) {
      result.errors++;
      const msg = e instanceof Error ? e.message : 'Erreur inconnue';
      console.error('[check-mails] mail error', { id: m.id, msg });
      result.items.push({ mail_id: m.id, from: m.from, subject: m.subject, action: 'error', error: msg });
      if (!dryRun) await logMailEntry({ mail_id: m.id, from: m.from, subject: m.subject, action: 'error', error: msg });
    }
  }

  if (!dryRun) await updateLastCheck();
  console.log('[check-mails] done', {
    elapsed_ms: Date.now() - t0,
    processed: result.processed,
    created: result.created,
    labeled_lu: result.labeled_lu,
    skipped: result.skipped,
    errors: result.errors,
  });
  return result;
}
