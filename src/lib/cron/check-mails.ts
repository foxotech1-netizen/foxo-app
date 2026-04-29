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
  mail: { from: string; subject: string; date: string; body_text: string; body_html: string },
): Promise<{ ok: true; analysis: CronMailAnalysis } | { ok: false; error: string }> {
  const bodyText = mail.body_text?.trim() ? mail.body_text : stripHtml(mail.body_html ?? '');
  const truncated = bodyText.slice(0, 6000);

  const userMessage = [
    `Tu analyses les emails entrants chez FoxO (détection de fuites en Belgique). Ton rôle :`,
    `1. Décider si l'email est une demande d'intervention concrète (fuite, dégât des eaux, surconsommation, inspection caméra…) — vrai pour les particuliers, syndics, courtiers qui sollicitent FoxO.`,
    `   FAUX pour : newsletters, factures fournisseurs, notifications automatiques, spam, mails internes, échanges sans demande nouvelle.`,
    `2. Si c'est une demande, extraire les données.`,
    ``,
    `## EMAIL`,
    `From : ${mail.from}`,
    `Sujet : ${mail.subject}`,
    `Date : ${mail.date}`,
    ``,
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
    `  "langue": "fr | nl | en" | null`,
    `}`,
    `Aucun champ inventé : si l'info n'est pas explicite, mets null.`,
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
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur Anthropic.' };
  }

  const parsed = tryParseJson(raw);
  if (!parsed) return { ok: false, error: 'Réponse Claude non parsable.' };

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
  };
  return { ok: true, analysis };
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
  };

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
      demandeur_type: 'particulier',
      particulier_contact: particulierContact,
      source: 'mail',
      source_mail_id: mail.id,
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
  const list = await listInboxMails({ limit: 30, q });
  if (!list.ok) {
    result.errors++;
    result.items.push({ mail_id: '', from: '', subject: '', action: 'error', error: list.error });
    return result;
  }
  if (list.mails.length === 0) {
    if (!dryRun) await updateLastCheck();
    return result;
  }

  for (const m of list.mails) {
    result.processed++;
    try {
      // Dédup côté DB : si on a déjà créé une intervention pour ce
      // mail_id (label Gmail perdu, p. ex.), on ne refait pas le boulot.
      if (await alreadyConvertedMail(m.id)) {
        result.skipped++;
        result.items.push({ mail_id: m.id, from: m.from, subject: m.subject, action: 'skipped' });
        continue;
      }

      const detailRes = await getMailDetail(m.id);
      if (!detailRes.ok) {
        result.errors++;
        result.items.push({ mail_id: m.id, from: m.from, subject: m.subject, action: 'error', error: detailRes.error });
        if (!dryRun) await logMailEntry({ mail_id: m.id, from: m.from, subject: m.subject, action: 'error', error: detailRes.error });
        continue;
      }

      const analyzeRes = await analyzeMailWithClaude(apiKey, {
        from: detailRes.mail.from,
        subject: detailRes.mail.subject,
        date: detailRes.mail.date,
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
        await addLabelToMail({ mailId: m.id, labelName: 'FOXO_TRAITE', removeUnread: true });
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
        await addLabelToMail({ mailId: m.id, labelName: 'FOXO_LU', removeUnread: true });
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
      result.items.push({ mail_id: m.id, from: m.from, subject: m.subject, action: 'error', error: msg });
      if (!dryRun) await logMailEntry({ mail_id: m.id, from: m.from, subject: m.subject, action: 'error', error: msg });
    }
  }

  if (!dryRun) await updateLastCheck();
  return result;
}
