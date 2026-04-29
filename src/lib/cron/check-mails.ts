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
const MAX_TOKENS = 1024;

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

export interface CronExtractedOccupant {
  prenom: string;
  nom: string;
  email: string;
  appartement: string;
  telephone: string;
}

export type CronDemandeurType = 'syndic' | 'courtier' | 'particulier';

export interface CronMailAnalysis {
  est_demande_intervention: boolean;
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
  reference_externe: string | null;
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

function tryParseJson(raw: string): Partial<CronMailAnalysis> | null {
  const fenced = raw.match(STRIP_FENCE_RE);
  const candidate = fenced ? fenced[1] : raw;
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === 'object') return parsed as Partial<CronMailAnalysis>;
  } catch { /* try next */ }
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(candidate.slice(start, end + 1)) as Partial<CronMailAnalysis>; }
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

async function analyzeMailWithClaude(
  apiKey: string,
  mail: { from: string; subject: string; date: string; cc: string; body_text: string; body_html: string },
): Promise<{ ok: true; analysis: CronMailAnalysis } | { ok: false; error: string }> {
  const bodyText = mail.body_text?.trim() ? mail.body_text : stripHtml(mail.body_html ?? '');
  const truncated = bodyText.slice(0, 6000);

  // Liste CC pré-parsée — donne à Claude un format propre plutôt qu'un
  // header brut. Vide si le mail n'a pas de Cc.
  const ccPairs = parseAddressList(mail.cc ?? '');
  const ccBlock = ccPairs.length > 0
    ? ccPairs.map((p) => `- "${p.name}" <${p.email}>`).join('\n')
    : '(aucun)';

  const userMessage = [
    `Tu analyses les emails entrants chez FoxO (détection de fuites en Belgique). Ton rôle :`,
    `1. Décider si l'email est une demande d'intervention concrète (fuite, dégât des eaux, surconsommation, inspection caméra…) — vrai pour les particuliers, syndics, courtiers qui sollicitent FoxO.`,
    `   FAUX pour : newsletters, factures fournisseurs, notifications automatiques, spam, mails internes, échanges sans demande nouvelle.`,
    `2. Si c'est une demande, extraire les données du demandeur principal.`,
    `3. Déterminer le type_demandeur :`,
    `   - "syndic" : mentionne copropriété, ACP, immeuble, syndic, lot, AG, parties communes, gestionnaire d'immeuble`,
    `   - "courtier" : mentionne assurance, sinistre, police, compagnie d'assurance, expertise, dégât assuré`,
    `   - "particulier" : demande personnelle, maison, appartement perso, propriétaire occupant`,
    `   Aussi extraire :`,
    `   - nom_societe : cabinet syndic, compagnie d'assurance (ex: "Wave-Immo SPRL", "BelGestion", "Assur Plus") — null si particulier`,
    `   - nom_immeuble : nom de la résidence ou adresse de l'ACP (ex: "Résidence Bellevue", "Rue de la Loi 42") — null si particulier`,
    `   - reference_externe : référence dossier syndic/courtier mentionnée (ex: "DOS-2026-123", "REF/456/2026") — null si absente`,
    `4. Analyser la liste CC pour identifier d'éventuels OCCUPANTS (résidents des appartements concernés). Le numéro d'appartement est souvent dans le nom :`,
    `   - "Dupont Apt 101 <dupont@gmail.com>" → appartement="101"`,
    `   - "Marie Leroy - Apt 3B <m.leroy@hotmail.com>" → appartement="3B"`,
    `   - "Pierre Martin (2ème étage) <pmartin@gmail.com>" → appartement="2ème étage"`,
    `   - "appartement 5 <occupant5@gmail.com>" → appartement="5"`,
    `   Cherche aussi les téléphones associés à ces noms dans le corps du mail (ex: "Marie : 0488 12 34 56").`,
    `   IGNORE les CC qui sont clairement des copies internes (foxo.be, syndic, etc.) — ne mets QUE des résidents/occupants.`,
    ``,
    `## EMAIL`,
    `From : ${mail.from}`,
    `Sujet : ${mail.subject}`,
    `Date : ${mail.date}`,
    ``,
    `## CC`,
    ccBlock,
    ``,
    `## CORPS`,
    truncated,
    ``,
    `## SORTIE`,
    `Retourne UNIQUEMENT du JSON pur, sans backticks, sans markdown :`,
    `{`,
    `  "est_demande_intervention": true | false,`,
    `  "nom_client": "Prénom Nom" | null,`,
    `  "adresse": "rue + numéro, code postal + ville" | null,`,
    `  "type_probleme": "Fuite canalisation | Fuite chauffage | Fuite infiltration | Surconsommation eau | Autre" | null,`,
    `  "telephone": "+32..." | null,`,
    `  "email": "email du demandeur" | null,`,
    `  "priorite": "urgente | normale" | null,`,
    `  "resume": "1-2 phrases décrivant le problème" | null,`,
    `  "langue": "fr | nl | en" | null,`,
    `  "type_demandeur": "syndic | courtier | particulier" | null,`,
    `  "nom_societe": "string" | null,`,
    `  "nom_immeuble": "string" | null,`,
    `  "reference_externe": "string" | null,`,
    `  "occupants": [`,
    `    {`,
    `      "prenom": "string",`,
    `      "nom": "string",`,
    `      "email": "string",`,
    `      "appartement": "string (numéro/étage/description)",`,
    `      "telephone": "string ou \\"\\"" `,
    `    }`,
    `  ]`,
    `}`,
    `Aucun champ inventé : si l'info n'est pas explicite, mets null (ou "" pour les champs occupant string requis).`,
    `Si aucun occupant identifiable dans les CC, retourne occupants: [].`,
  ].join('\n');

  // timeout SDK (vrai abort, pas Promise.race) — sinon défaut 600s.
  const client = new Anthropic({ apiKey, timeout: CLAUDE_TIMEOUT_MS });
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
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur Anthropic.' };
  }

  const parsed = tryParseJson(raw);
  if (!parsed) return { ok: false, error: 'Réponse Claude non parsable.' };

  // Extraction sûre du tableau d'occupants
  const occupantsRaw = Array.isArray((parsed as { occupants?: unknown }).occupants)
    ? ((parsed as { occupants: unknown[] }).occupants)
    : [];
  const occupants: CronExtractedOccupant[] = occupantsRaw
    .map((o): CronExtractedOccupant | null => {
      if (!o || typeof o !== 'object') return null;
      const r = o as Record<string, unknown>;
      const email = typeof r.email === 'string' ? r.email.trim() : '';
      // Filtre : un occupant doit AU MOINS avoir un email valide ou un téléphone
      const tel = typeof r.telephone === 'string' ? r.telephone.trim() : '';
      if (!email && !tel) return null;
      return {
        prenom: typeof r.prenom === 'string' ? r.prenom.trim() : '',
        nom: typeof r.nom === 'string' ? r.nom.trim() : '',
        email,
        appartement: typeof r.appartement === 'string' ? r.appartement.trim() : '',
        telephone: tel,
      };
    })
    .filter((x): x is CronExtractedOccupant => x !== null);

  const td = (parsed as { type_demandeur?: unknown }).type_demandeur;
  const typeDemandeur: CronDemandeurType | null =
    td === 'syndic' || td === 'courtier' || td === 'particulier' ? td : null;

  const analysis: CronMailAnalysis = {
    est_demande_intervention: parsed.est_demande_intervention === true,
    nom_client: typeof parsed.nom_client === 'string' ? parsed.nom_client : null,
    adresse: typeof parsed.adresse === 'string' ? parsed.adresse : null,
    type_probleme: typeof parsed.type_probleme === 'string' ? parsed.type_probleme : null,
    telephone: typeof parsed.telephone === 'string' ? parsed.telephone : null,
    email: typeof parsed.email === 'string' ? parsed.email : null,
    priorite: parsed.priorite === 'urgente' || parsed.priorite === 'normale' ? parsed.priorite : null,
    resume: typeof parsed.resume === 'string' ? parsed.resume : null,
    langue: parsed.langue === 'fr' || parsed.langue === 'nl' || parsed.langue === 'en' ? parsed.langue : null,
    occupants,
    type_demandeur: typeDemandeur,
    nom_societe: typeof (parsed as { nom_societe?: unknown }).nom_societe === 'string'
      ? (parsed as { nom_societe: string }).nom_societe : null,
    nom_immeuble: typeof (parsed as { nom_immeuble?: unknown }).nom_immeuble === 'string'
      ? (parsed as { nom_immeuble: string }).nom_immeuble : null,
    reference_externe: typeof (parsed as { reference_externe?: unknown }).reference_externe === 'string'
      ? (parsed as { reference_externe: string }).reference_externe : null,
  };
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

async function matchOrCreateOrganisation(args: {
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

async function matchOrCreateClient(args: {
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

  const particulierContact = {
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

  // Matching org/client selon type_demandeur
  let organisationId: string | null = null;
  let clientId: string | null = null;
  if (analysis.type_demandeur === 'syndic' || analysis.type_demandeur === 'courtier') {
    const matched = await matchOrCreateOrganisation({
      type: analysis.type_demandeur,
      nomSociete: analysis.nom_societe,
      email: emailAddr,
      telephone: tel,
    });
    organisationId = matched?.id ?? null;
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

  const { data: iv, error } = await admin
    .from('interventions')
    .insert({
      ref,
      statut: 'nouvelle',
      priorite,
      type,
      description: analysis.resume ?? `(extrait par IA — sujet : ${mail.subject})`,
      adresse: adresseFormatee,
      date_demande: new Date().toISOString().slice(0, 10),
      demandeur_type: demandeurType,
      particulier_contact: particulierContact,
      source: 'mail',
      source_mail_id: mail.id,
      reference_externe: analysis.reference_externe ?? null,
      organisation_id: organisationId,
      client_id: clientId,
    })
    .select('id, ref')
    .single();
  if (error || !iv) return { ok: false, error: error?.message ?? 'Insert failed' };

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

  // Création automatique des occupants extraits depuis les CC.
  // contact_preference : email si email présent, sinon sms si tel,
  // sinon email par défaut (au moins on a un canal listé).
  const occupantsToInsert = (analysis.occupants ?? [])
    .filter((o) => o.email || o.telephone)
    .map((o) => ({
      intervention_id: iv.id,
      appartement: o.appartement || null,
      etage: null,
      prenom: o.prenom || null,
      nom: o.nom || null,
      email: o.email || null,
      telephone: o.telephone || null,
      conf: 'en_attente' as const,
      contact_preference: o.email ? 'email' : (o.telephone ? 'sms' : 'email'),
      // Marqueur "extrait du mail" : on stocke la source dans instructions
      // de manière neutre (pas de colonne dédiée, mais lisible côté UI)
      instructions: '[extrait du mail]',
    }));
  if (occupantsToInsert.length > 0) {
    try {
      const { error: occErr } = await admin.from('occupants').insert(occupantsToInsert);
      if (occErr) {
        console.warn('[check-mails] occupants insert failed:', occErr.message);
      } else {
        console.log('[check-mails] occupants créés :', occupantsToInsert.length);
      }
    } catch (e) {
      console.warn('[check-mails] occupants insert threw:', e);
    }
  }

  return { ok: true, intervention_id: iv.id as string, ref: iv.ref as string };
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
