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

const MODEL = 'claude-sonnet-4-6';
// Le JSON nested du nouveau prompt FoxO (demandeur.contacts[],
// acp, intervention, occupants[], assurance, action_requise, …)
// dépasse facilement 1024 tokens — surtout avec plusieurs contacts +
// plusieurs occupants. 1024 → réponse tronquée → unparsable.
const MAX_TOKENS = 4096;

// Limites runtime — calibrées pour rester sous maxDuration=60s côté
// Vercel. 5 mails × (10s Gmail + 30s Claude + 5s écriture) ≈ 45s pire cas.
const MAX_MAILS_PER_RUN = 5;
const GMAIL_TIMEOUT_MS = 10_000;
const CLAUDE_TIMEOUT_MS = 30_000;

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

export type CronOccupantType = 'occupant' | 'proprietaire' | 'parties_communes';

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

  const userMessage = [
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
    `      "type": "occupant" | "proprietaire" | "parties_communes",`,
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
      prompt_chars: userMessage.length,
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
      prompt_chars: userMessage.length,
    });
  }

  // timeout SDK (vrai abort, pas Promise.race) — sinon défaut 600s.
  const client = new Anthropic({ apiKey, timeout: CLAUDE_TIMEOUT_MS });
  let raw: string;
  let stopReason: string | null = null;
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: userMessage }],
    });
    const block = msg.content[0];
    raw = block && block.type === 'text' ? block.text : '';
    stopReason = msg.stop_reason ?? null;
  } catch (e) {
    console.error('[analyzeMailWithClaude] anthropic threw', e);
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur Anthropic.' };
  }

  console.error('[analyzeMailWithClaude] claude raw response', {
    raw_chars: raw.length,
    stop_reason: stopReason,
    raw_preview: raw.slice(0, 1500),
    truncated: stopReason === 'max_tokens',
  });

  const parsed = tryParseJson(raw);
  if (!parsed) {
    console.error('[analyzeMailWithClaude] JSON parse failed', {
      stop_reason: stopReason,
      raw_chars: raw.length,
      raw_full: raw,
    });
    // Surface des info parlantes dans l'erreur (visible côté API caller)
    const tail = raw.slice(-200).replace(/\s+/g, ' ').trim();
    const head = raw.slice(0, 200).replace(/\s+/g, ' ').trim();
    const reason = stopReason === 'max_tokens'
      ? 'tronquée (max_tokens atteint)'
      : 'non valide';
    return {
      ok: false,
      error: `Réponse Claude ${reason}. Début: "${head}…" Fin: "…${tail}"`,
    };
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
      const type: CronOccupantType = tRaw === 'parties_communes' || tRaw === 'proprietaire'
        ? tRaw
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
  const rawOccupantsCount = Array.isArray((parsed as { occupants?: unknown }).occupants)
    ? (parsed as { occupants: unknown[] }).occupants.length : 0;
  console.info('[analyzeMailWithClaude] post-filter', {
    occupants_kept: occupants.length,
    occupants_dropped: rawOccupantsCount - occupants.length,
    final_occupants: occupants.map((o) => ({
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

// Match-or-create d'une ACP/immeuble pour un syndic donné. Cherche par
// nom partiel (ILIKE) avec filtre syndic_id|syndic_id_ref. Ne crée pas
// automatiquement si non trouvé : on préfère laisser l'admin associer
// manuellement depuis le drawer pour éviter les doublons (les noms
// d'immeubles sont souvent ambigus : "Résidence du Parc" peut exister
// dans plusieurs villes).
interface MatchedAcpResult { id: string; created: boolean }
export async function matchAcpForOrganisation(args: {
  organisation_id: string;
  nom_immeuble: string;
}): Promise<MatchedAcpResult | null> {
  if (!args.nom_immeuble || !args.organisation_id) return null;
  const admin = createAdminClient();
  const safe = args.nom_immeuble.replace(/[%_,()]/g, ' ').trim();
  if (!safe) return null;
  // Recherche par nom partiel filtrée par syndic (deux colonnes legacy)
  const { data, error } = await admin
    .from('acps')
    .select('id, syndic_id, syndic_id_ref')
    .or(`syndic_id.eq.${args.organisation_id},syndic_id_ref.eq.${args.organisation_id}`)
    .ilike('nom', `%${safe}%`)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('[check-mails] acp lookup failed:', error.message);
    return null;
  }
  if (data?.id) {
    console.log('[check-mails] ACP matchée :', { nom: args.nom_immeuble, id: data.id });
    return { id: data.id as string, created: false };
  }
  return null;
}

// ─── Détection de doublons / dossiers liés ──────────────────────────────
//
// Avant de créer une nouvelle intervention depuis un mail, on cherche
// un dossier existant qui correspond. Trois signaux à confiance haute :
//   1. reference_sinistre (assurance) identique → même_dossier
//   2. ACP identique + email occupant déjà connu + < 30j → suivi
//   3. ACP identique + un appartement_concerné en commun + < 30j → même_dossier
// Renvoie le 1er match trouvé (ou null), avec son type_lien.

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

  // Window 30j pour les heuristiques ACP-based
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const sinceIso = thirtyDaysAgo.toISOString();

  if (args.acp_id) {
    // 2. ACP identique + email occupant connu + < 30j → suivi
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
              reason: 'Même ACP + occupant déjà connu (< 30j)',
            };
          }
        }
      }
    }

    // 3. ACP identique + appartement commun + < 30j → meme_dossier
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
          reason: `Même ACP + appartement(s) commun(s) (< 30j) : ${apts.join(', ')}`,
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

      // ACP : match par nom partiel sur le syndic (best effort).
      if (analysis.nom_immeuble) {
        const matchedAcp = await matchAcpForOrganisation({
          organisation_id: organisationId,
          nom_immeuble: analysis.nom_immeuble,
        });
        acpId = matchedAcp?.id ?? null;
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
    const colMissing = insertErr?.code === '42703' || /column .* does not exist/i.test(insertErr?.message ?? '');
    if (!colMissing) break;
    // Parse le nom de la colonne manquante
    const m = (insertErr?.message ?? '').match(/column\s+(?:"|')?([a-z_][a-z0-9_]*)(?:"|')?\s+(?:of\s+relation|does not exist)/i);
    const missingCol = m?.[1];
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

// Extrait le nom de la colonne mentionnée dans une erreur PostgREST
// "column 'foo' of relation 'occupants' does not exist" ou variantes.
function parseMissingColumn(message: string): string | null {
  const m1 = message.match(/column\s+(?:"|')?([a-z_][a-z0-9_]*)(?:"|')?\s+of\s+relation/i);
  if (m1) return m1[1];
  const m2 = message.match(/column\s+(?:"|')?([a-z_][a-z0-9_]*)(?:"|')?\s+does not exist/i);
  if (m2) return m2[1];
  // PostgREST renvoie parfois juste "foo does not exist" sans "column"
  const m3 = message.match(/(?:^|\s)([a-z_][a-z0-9_]*)\s+does not exist/i);
  if (m3) return m3[1];
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
      const colMissing = code === '42703' || /column .* does not exist/i.test(error.message);
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
        const createRes = await createInterventionFromMail(
          { id: m.id, from: m.from, subject: m.subject },
          analysis,
        );
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
