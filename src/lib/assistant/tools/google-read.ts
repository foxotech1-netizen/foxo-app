// src/lib/assistant/tools/google-read.ts
//
// Outils LECTURE SEULE Google (Gmail + Agenda) pour l'assistant IA admin (Phase 2).
//
// Ces outils emballent des fonctions existantes de src/lib/gmail.ts et
// src/lib/google-calendar.ts. Ils s'appuient TOUS sur le token Google
// applicatif unique de la société (getValidAccessToken, géré en interne par
// ces fonctions) : aucune nouvelle plomberie d'auth. Si Google n'est pas
// connecté, les fonctions sous-jacentes dégradent proprement (message clair).
//
// Lecture seule : aucun envoi, aucune modification de label, aucune écriture
// d'événement. Les corps de mails ne sont JAMAIS placés dans les logs runAgent
// (la route ne journalise que des compteurs) — ils ne transitent que dans la
// conversation envoyée au modèle, ce qui est nécessaire et voulu.

import type Anthropic from '@anthropic-ai/sdk';
import { listInboxMails, getEmailThread, countUnreadMails } from '@/lib/gmail';
import { getCalendarEvents } from '@/lib/google-calendar';

export const GOOGLE_READ_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_emails',
    description:
      "Recherche dans la boîte Gmail de la société (lecture seule). Le paramètre 'query' accepte la syntaxe de recherche Gmail. " +
      "Exemples : 'from:regimo.be is:unread', 'subject:fuite newer_than:14d', 'to:info@foxo.be after:2026/05/01'. " +
      "Sans 'query', renvoie les mails les plus récents de la boîte. Chaque résultat affiche son identifiant de fil [thread_id] : utilise get_email_thread avec cet identifiant pour lire l'échange complet.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Requête en syntaxe de recherche Gmail (optionnel).' },
        limit: { type: 'integer', description: 'Nombre maximum de mails (défaut 15, max 50).' },
      },
      required: [],
    },
  },
  {
    name: 'get_email_thread',
    description:
      "Lit le contenu complet d'un fil d'emails (tous les messages de l'échange) à partir de son thread_id, obtenu via search_emails. À utiliser pour comprendre le détail d'une conversation.",
    input_schema: {
      type: 'object',
      properties: {
        thread_id: { type: 'string', description: 'Identifiant du fil (champ [thread_id] renvoyé par search_emails).' },
      },
      required: ['thread_id'],
    },
  },
  {
    name: 'count_unread_emails',
    description: "Renvoie le nombre de mails non lus dans la boîte Gmail de la société.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_calendar_events',
    description:
      "Liste les événements de l'agenda Google de la société sur une fenêtre de dates (lecture seule). " +
      "Fournis date_min et date_max au format AAAA-MM-JJ. Sans dates, renvoie les 7 prochains jours à partir d'aujourd'hui.",
    input_schema: {
      type: 'object',
      properties: {
        date_min: { type: 'string', description: 'Début de la fenêtre (AAAA-MM-JJ).' },
        date_max: { type: 'string', description: 'Fin de la fenêtre (AAAA-MM-JJ).' },
      },
      required: [],
    },
  },
];

export async function executeGoogleReadTool(name: string, input: unknown): Promise<string> {
  try {
    const args = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    switch (name) {
      case 'search_emails':
        return await searchEmailsTool(args);
      case 'get_email_thread':
        return await getEmailThreadTool(args);
      case 'count_unread_emails':
        return await countUnreadTool();
      case 'list_calendar_events':
        return await listCalendarEventsTool(args);
      default:
        return `Outil inconnu : ${name}.`;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'erreur inconnue';
    return `Erreur lors de l'exécution de l'outil ${name} : ${msg}`;
  }
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '?';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '?' : d.toLocaleString('fr-BE');
}

async function searchEmailsTool(args: Record<string, unknown>): Promise<string> {
  let limit = typeof args.limit === 'number' ? Math.floor(args.limit) : 15;
  if (!Number.isFinite(limit) || limit <= 0) limit = 15;
  if (limit > 50) limit = 50;
  const q = typeof args.query === 'string' ? args.query.trim() : '';

  const res = await listInboxMails({ limit, q: q || undefined });
  if (!res.ok) return `Erreur Gmail : ${res.error}`;
  if (res.mails.length === 0) return `Aucun mail ne correspond${q ? ` à « ${q} »` : ''}.`;

  const lines = res.mails.map((m) => {
    const unread = m.unread ? ' · NON LU' : '';
    const snip = (m.snippet ?? '').replace(/\s+/g, ' ').slice(0, 160);
    return `- [${m.thread_id}] ${fmtDate(m.date)} · ${m.from} · ${m.subject || '(sans objet)'}${unread}\n    ${snip}`;
  });
  const header = `${res.mails.length} mail(s)${q ? ` pour « ${q} »` : ''} :`;
  return [header, ...lines].join('\n');
}

async function getEmailThreadTool(args: Record<string, unknown>): Promise<string> {
  const threadId = typeof args.thread_id === 'string' ? args.thread_id.trim() : '';
  if (!threadId) return "Paramètre 'thread_id' manquant.";

  const res = await getEmailThread(threadId);
  if (!res.ok) return `Erreur Gmail : ${res.error}`;
  if (res.messages.length === 0) return 'Fil introuvable ou vide (Google peut-être non connecté).';

  const MAX_MSG = 15;
  const BODY = 1200;
  const msgs = res.messages.slice(0, MAX_MSG);
  const blocks = msgs.map((m, i) => {
    const full = (m.body_text ?? m.snippet ?? '').trim();
    const body = full.slice(0, BODY);
    const trunc = full.length > BODY ? ' […tronqué]' : '';
    return `── Message ${i + 1} ── ${fmtDate(m.date)}\nDe : ${m.from}\nÀ : ${m.to ?? '—'}\nObjet : ${m.subject || '(sans objet)'}\n${body}${trunc}`;
  });
  const header = `Fil ${threadId} — ${res.messages.length} message(s)${res.messages.length > MAX_MSG ? ` (affichage limité aux ${MAX_MSG} premiers)` : ''} :`;
  return [header, ...blocks].join('\n\n');
}

async function countUnreadTool(): Promise<string> {
  const n = await countUnreadMails();
  return `${n} mail(s) non lu(s) dans la boîte société.`;
}

function dayBound(s: unknown, suffix: string, fallback: Date): Date {
  if (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s.slice(0, 10) + suffix);
    if (!isNaN(d.getTime())) return d;
  }
  return fallback;
}

async function listCalendarEventsTool(args: Record<string, unknown>): Promise<string> {
  const now = new Date();
  const defFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const defTo = new Date(defFrom.getTime() + 7 * 24 * 60 * 60 * 1000);

  const from = dayBound(args.date_min, 'T00:00:00', defFrom);
  const to = dayBound(args.date_max, 'T23:59:59', defTo);

  const res = await getCalendarEvents({ from, to });
  if (!res.ok) return `Erreur Agenda : ${res.error}`;
  if (res.events.length === 0) {
    return `Aucun événement entre le ${from.toLocaleDateString('fr-BE')} et le ${to.toLocaleDateString('fr-BE')}.`;
  }

  const lines = res.events.map((e) => {
    const allDay = !e.start.dateTime && !!e.start.date;
    const when = e.start.dateTime ? new Date(e.start.dateTime).toLocaleString('fr-BE') : (e.start.date ?? '?');
    const loc = e.location ? ` · ${e.location}` : '';
    return `- ${when}${allDay ? ' (journée)' : ''} · ${e.summary || '(sans titre)'}${loc}`;
  });
  const header = `${res.events.length} événement(s) du ${from.toLocaleDateString('fr-BE')} au ${to.toLocaleDateString('fr-BE')} :`;
  return [header, ...lines].join('\n');
}
