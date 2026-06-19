// POST /api/admin/mails/draft-reply
// Body : { thread_id: string, target: 'syndic' | 'occupant', mode?: 'gmail_draft' | 'inline' }
// Response (gmail_draft, défaut) : { success, draft_id, gmail_url }
// Response (inline)              : { success, draft_text }
//
// Mode gmail_draft (historique) : génère un brouillon Gmail rattaché au
// thread d'origine pour répondre soit au syndic (confirmation prise en
// charge + créneau), soit à l'occupant (proposition créneau + demande de
// confirmation). target requis, analyse requise.
//
// Mode inline (Phase 3 U4) : renvoie UNIQUEMENT le texte généré, destiné au
// composer de réponse du volet /admin/mails — AUCUN brouillon Gmail créé,
// brouillon_gmail_id intact. target ignoré, analyse OPTIONNELLE (bonus de
// contexte) ; le fil complet est fourni au modèle, la réponse est rédigée
// dans la langue détectée.
//
// AUCUN ENVOI dans les deux modes — l'admin valide depuis Gmail web
// (gmail_draft) ou relit/édite puis clique Envoyer lui-même (inline).

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from "@/lib/auth/server";
import { getEmailThread, createGmailDraft } from '@/lib/gmail';
import { runAgent } from '@/lib/observability';

export const dynamic = 'force-dynamic';
// Fetch du thread Gmail + génération : marge confortable (aligné sur les
// autres routes mails IA).
export const maxDuration = 60;

const MODEL = 'claude-sonnet-4-6';

interface DraftReplyBody {
  thread_id?: unknown;
  target?: unknown;
  mode?: unknown;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ success: false, error: 'Accès refusé.' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as DraftReplyBody;
  const threadId = typeof body.thread_id === 'string' ? body.thread_id.trim() : '';
  const mode = body.mode === 'inline' ? 'inline' : 'gmail_draft';
  const target = body.target === 'syndic' || body.target === 'occupant' ? body.target : null;
  // target n'a de sens que pour le brouillon Gmail (choix du destinataire) ;
  // le mode inline répond dans le composer, destinataire géré par sendReply.
  if (!threadId || (mode === 'gmail_draft' && !target)) {
    return NextResponse.json({ success: false, error: 'thread_id + target requis.' }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ success: false, error: 'ANTHROPIC_API_KEY manquante.' }, { status: 500 });

  const admin = createAdminClient();

  // 1. Récup mails_analyses — REQUISE en gmail_draft (prompt ciblé créneau/
  //    destinataire), OPTIONNELLE en inline (bonus de contexte).
  const { data: analyseRow, error: anaErr } = await admin
    .from('mails_analyses')
    .select('*')
    .eq('thread_id', threadId)
    .maybeSingle();
  if (anaErr) return NextResponse.json({ success: false, error: anaErr.message }, { status: 500 });
  if (!analyseRow && mode === 'gmail_draft') {
    return NextResponse.json(
      { success: false, error: 'Mail non analysé, lancer analyse-deep d\'abord.' },
      { status: 404 },
    );
  }
  type AnalyseLite = {
    langue: string | null;
    classification: string | null;
    occupant_email: string | null;
    occupant_telephone: string | null;
    resume: string | null;
    acp_nom: string | null;
    syndic_nom: string | null;
    occupants_extraits: Array<{ prenom?: string; nom?: string; appartement?: string; type?: string }> | null;
    dossier_match_id: string | null;
    creneau_propose_id: string | null;
  };
  const analyse: AnalyseLite | null = (analyseRow as AnalyseLite | null) ?? null;

  // 2. Récup dossier (ref + adresse + syndic)
  type DossierLite = { ref: string | null; adresse: string | null; syndic_id: string | null };
  let dossier: DossierLite | null = null;
  if (analyse?.dossier_match_id) {
    const { data } = await admin
      .from('interventions')
      .select('ref, adresse, syndic_id')
      .eq('id', analyse.dossier_match_id)
      .maybeSingle();
    if (data) dossier = data as DossierLite;
  }

  // 3. Récup syndic email (si target=syndic)
  let syndicEmail: string | null = null;
  let syndicNom: string | null = null;
  if (target === 'syndic' && dossier?.syndic_id) {
    const { data } = await admin
      .from('organisations')
      .select('nom, email')
      .eq('id', dossier.syndic_id)
      .maybeSingle();
    if (data) {
      const o = data as { nom: string | null; email: string | null };
      syndicEmail = o.email;
      syndicNom = o.nom;
    }
  }

  // 4. Récup créneau proposé (date + heure + technicien)
  let creneauInfo: { date: string; heure_debut: string; heure_fin: string; technicien_nom: string } | null = null;
  if (analyse?.creneau_propose_id) {
    const { data: cre } = await admin
      .from('creneaux_disponibles')
      .select('date, heure_debut, heure_fin, technicien_id')
      .eq('id', analyse.creneau_propose_id)
      .maybeSingle();
    if (cre) {
      const c = cre as { date: string; heure_debut: string; heure_fin: string; technicien_id: string | null };
      let techNom = '?';
      if (c.technicien_id) {
        const { data: tech } = await admin
          .from('utilisateurs')
          .select('prenom, nom')
          .eq('id', c.technicien_id)
          .maybeSingle();
        if (tech) {
          const t = tech as { prenom: string | null; nom: string | null };
          techNom = [t.prenom, t.nom].filter(Boolean).join(' ').trim() || 'Technicien';
        }
      }
      creneauInfo = {
        date: c.date,
        heure_debut: c.heure_debut.slice(0, 5),
        heure_fin: c.heure_fin.slice(0, 5),
        technicien_nom: techNom,
      };
    }
  }

  // 5. Détermine destinataire — gmail_draft uniquement (en inline, le
  //    destinataire est celui du composer, géré à l'envoi par sendReply).
  const toRecipient = target === 'syndic' ? syndicEmail : analyse?.occupant_email ?? null;
  if (mode === 'gmail_draft' && !toRecipient) {
    return NextResponse.json(
      { success: false, error: `Destinataire ${target} introuvable (email manquant).` },
      { status: 400 },
    );
  }

  // 6. Récup dernier message du thread (pour l'origine des en-têtes In-Reply-To)
  const threadRes = await getEmailThread(threadId);
  if (!threadRes.ok) {
    return NextResponse.json({ success: false, error: threadRes.error }, { status: 502 });
  }
  if (threadRes.messages.length === 0) {
    return NextResponse.json({ success: false, error: 'Thread vide.' }, { status: 404 });
  }
  // Le plus récent = dernier de la liste (Gmail trie par date asc).
  const lastMsg = threadRes.messages[threadRes.messages.length - 1];

  // 7. Génération du body via Claude
  // Langue : celle de l'analyse si connue ; en inline sans analyse, le
  // modèle détecte la langue du fil et répond dans cette langue.
  const langueSpoken = analyse?.langue === 'nl' ? 'NL'
    : analyse?.langue === 'en' ? 'EN'
    : analyse?.langue === 'fr' ? 'FR'
    : null;
  const langueInstruction = langueSpoken
    ? `Langue de réponse : ${langueSpoken === 'NL' ? 'Néerlandais' : langueSpoken === 'EN' ? 'Anglais' : 'Français'}`
    : `Langue de réponse : la langue du dernier message du fil (détecte-la).`;
  const dateLabel = creneauInfo
    ? formatDateFr(creneauInfo.date)
    : null;

  const systemPrompt = mode === 'inline'
    ? [
        `Tu rédiges une réponse de mail professionnelle courte (max 180 mots) au nom de FoxO`,
        `(détection de fuites non destructive en Belgique). On te fournit le fil de`,
        `discussion complet : réponds au DERNIER message du fil, de manière pertinente`,
        `et concrète. Ne promets jamais une date ou un engagement qui ne figure pas`,
        `dans le contexte fourni.`,
        `Ton : professionnel, cordial, direct. Pas d'emojis, pas de markdown.`,
        `Signature obligatoire en fin de mail, sobre : "Fox Group srl"`,
        ``,
        langueInstruction,
        ``,
        `Retourne UNIQUEMENT le corps du mail (pas de "Objet:", pas de "Bonjour [Nom]" si tu ne connais pas le nom — utilise un "Bonjour," neutre).`,
      ].join('\n')
    : [
        `Tu rédiges un mail professionnel court (max 150 mots) au nom de FoxO`,
        `(détection de fuites non destructive en Belgique).`,
        `Ton : professionnel, cordial, direct. Pas d'emojis, pas de markdown.`,
        `Signature obligatoire en fin de mail : "Christophe Mertens — FoxO"`,
        ``,
        langueInstruction,
        ``,
        target === 'syndic'
          ? `Cible : SYNDIC. Confirme la prise en charge du dossier${dossier?.ref ? ' ' + dossier.ref : ''}. Mentionne la date proposée et le nom du technicien si disponibles. Ne demande pas confirmation, c'est une notification.`
          : `Cible : OCCUPANT. Propose le créneau de RDV pour la détection de fuite. Mentionne la date, l'heure et la durée approximative (1h30). Demande une confirmation par retour.`,
        ``,
        `Retourne UNIQUEMENT le corps du mail (pas de "Objet:", pas de "Bonjour [Nom]" si tu ne connais pas le nom — utilise un "Bonjour," neutre).`,
      ].join('\n');

  const ctxParts: string[] = [];
  if (dossier) {
    ctxParts.push(`Dossier : ${dossier.ref ?? '?'} — ${dossier.adresse ?? '?'}`);
    if (target === 'syndic' && syndicNom) ctxParts.push(`Syndic destinataire : ${syndicNom}`);
  }
  if (creneauInfo && dateLabel) {
    ctxParts.push(`Créneau proposé : ${dateLabel} de ${creneauInfo.heure_debut} à ${creneauInfo.heure_fin}`);
    ctxParts.push(`Technicien assigné : ${creneauInfo.technicien_nom}`);
  }
  if (analyse?.resume) ctxParts.push(`Contexte de la demande initiale : ${analyse.resume}`);
  // Contexte bonus inline (Phase 3) : classification, ACP/syndic extraits,
  // occupants identifiés — quand l'analyse existe.
  if (mode === 'inline' && analyse) {
    if (analyse.classification) ctxParts.push(`Classification du mail : ${analyse.classification}`);
    if (analyse.acp_nom) ctxParts.push(`ACP / copropriété : ${analyse.acp_nom}`);
    if (analyse.syndic_nom) ctxParts.push(`Syndic : ${analyse.syndic_nom}`);
    const occs = (analyse.occupants_extraits ?? [])
      .map((o) => [
        [o.prenom, o.nom].filter(Boolean).join(' ').trim(),
        o.appartement ? `apt ${o.appartement}` : '',
        o.type ?? '',
      ].filter(Boolean).join(', '))
      .filter(Boolean);
    if (occs.length > 0) ctxParts.push(`Occupants identifiés : ${occs.join(' | ')}`);
  }

  // En inline, le fil complet est la matière première de la réponse (le mode
  // gmail_draft historique garde son prompt court sans fil — inchangé).
  const threadTextForPrompt = mode === 'inline'
    ? threadRes.messages
        .map((m) => `--- Message du ${m.date} de ${m.from} ---\n${m.body_text}`)
        .join('\n\n')
    : null;

  const userPrompt = threadTextForPrompt
    ? `Contexte :\n${ctxParts.join('\n') || '(aucun contexte spécifique)'}\n\nFil de discussion complet :\n${threadTextForPrompt}\n\nRédige le corps de la réponse au dernier message.`
    : `Contexte :\n${ctxParts.join('\n') || '(aucun contexte spécifique)'}\n\nRédige le corps du mail.`;

  let bodyText: string;
  try {
    const { output } = await runAgent<string>({
      agentName: 'draft_reply',
      agentKind: 'utility',
      model: MODEL,
      interventionId: analyse?.dossier_match_id ?? null,
      inputSummary: {
        mode,
        target,
        langue:             langueSpoken ?? 'auto',
        has_analyse:        analyse !== null,
        has_dossier:        dossier !== null,
        has_creneau:        creneauInfo !== null,
        has_syndic_nom:     syndicNom !== null,
        has_resume:         (analyse?.resume ?? '') !== '',
        prompt_user_chars:  userPrompt.length,
      },
      run: async () => {
        const client = new Anthropic({ apiKey });
        const msg = await client.messages.create({
          model: MODEL,
          max_tokens: 600,
          temperature: 0.5,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        });
        const block = msg.content[0];
        const text = block && block.type === 'text' ? block.text.trim() : '';
        if (!text) throw new Error('Réponse Claude vide.');
        const wordCount = text.split(/\s+/).filter(Boolean).length;
        return {
          message: msg,
          output: text,
          outputSummary: {
            body_chars:         text.length,
            body_words:         wordCount,
            body_over_150_words: wordCount > 150,
          },
        };
      },
    });
    bodyText = output;
  } catch (e) {
    return NextResponse.json(
      { success: false, error: `Anthropic : ${e instanceof Error ? e.message : 'inconnu'}` },
      { status: 502 },
    );
  }

  // Mode inline : le texte est la réponse — pas de brouillon Gmail, pas
  // d'écriture brouillon_gmail_id. L'admin relit/édite dans le composer et
  // envoie lui-même via sendReply.
  if (mode === 'inline') {
    return NextResponse.json({ success: true, draft_text: bodyText });
  }

  // 8. Création du brouillon Gmail (pas d'envoi)
  const draftRes = await createGmailDraft({
    mailId: lastMsg.id,
    to: toRecipient!,
    body: bodyText,
  });
  if (!draftRes.ok) {
    return NextResponse.json({ success: false, error: draftRes.error }, { status: 502 });
  }

  // 9. UPDATE mails_analyses.brouillon_gmail_id
  await admin
    .from('mails_analyses')
    .update({ brouillon_gmail_id: draftRes.draft_id, updated_at: new Date().toISOString() })
    .eq('thread_id', threadId);

  return NextResponse.json({
    success: true,
    draft_id: draftRes.draft_id,
    gmail_url: draftRes.gmail_url,
  });
}

function formatDateFr(iso: string): string {
  // 'YYYY-MM-DD' → 'jeudi 15 mai 2026'
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString('fr-BE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
