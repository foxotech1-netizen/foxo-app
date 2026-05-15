// POST /api/admin/mails/analyse-deep
// Body : { thread_id: string }
// Response : { success, analyse?, errors? }
//
// Pipeline 11 étapes :
//   1. Guard admin
//   2. Charge thread Gmail (via getEmailThread de @/lib/gmail)
//   3. Contexte FoxO (50 syndics + 5 dossiers actifs récents)
//   4. Claude (claude-sonnet-4-6) → JSON strict
//   5. Parse ; si invalide → 500
//   6. Match dossier (ref puis fuzzy adresse)
//   7. Si demande_intervention sans match → géocode Nominatim, crée
//      dossier Drive (createInterventionFolderFromMail), INSERT intervention
//   8. Stocke pièces jointes Gmail dans Drive
//   9. proposeCreneau si demande_intervention
//  10. UPSERT mails_analyses (toujours — permet retry idempotent)
//  11. Réponse enrichie
//
// ⚠ Aucun envoi automatique vers le client (règle d'or FoxO).

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { roleForEmail } from '@/lib/auth/roles';
import { getEmailThread } from '@/lib/gmail';
import { proposeCreneau, type CreneauPropose } from '@/lib/mails/propose-creneau';
import type { TypeIntervention } from '@/lib/mails/intervention-types';
import { runAgent } from '@/lib/observability';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MODEL = 'claude-sonnet-4-6';
const NOMINATIM_API = 'https://nominatim.openstreetmap.org/search';

// ─── Types ────────────────────────────────────────────────────────────

type AnalyseType =
  | 'demande_intervention'
  | 'relance_rapport'
  | 'suivi_dossier'
  | 'question_generale'
  | 'accuse_reception'
  | 'spam_commercial';

interface ClaudeAnalyse {
  type: AnalyseType;
  type_intervention: TypeIntervention | null;
  urgence: boolean;
  langue: 'fr' | 'nl' | 'en' | 'other';
  adresse_extraite: string | null;
  numero_dossier_mentionne: string | null;
  resume: string;
  occupant_telephone: string | null;
  occupant_email: string | null;
}

interface DossierInfo {
  id: string;
  ref: string | null;
  adresse: string | null;
}

// ─── Helper extraction JSON (Claude entoure parfois le JSON de fences
//     ```json … ``` ou ajoute un préambule "Voici le JSON :", malgré
//     l'instruction stricte. extractJson nettoie de manière robuste avant
//     parse). ──────────────────────────────────────────────────────────

function extractJson(raw: string): string {
  let s = raw.trim();
  // Strip markdown fences ```json ... ``` ou ``` ... ```
  s = s.replace(/^```(?:json)?\s*\n?/i, '');
  s = s.replace(/\n?```\s*$/i, '');
  // Extract first { to last }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Aucun objet JSON trouvé dans la réponse');
  }
  return s.slice(start, end + 1);
}

// ─── Helper Nominatim (best-effort) ───────────────────────────────────
//
// Cascade de tentatives : adresse complète → adresse nettoyée (sans
// "Résidence X", "Apt Y", "Bât Z", "Étage N") → ville seule (dernier
// segment après dernière virgule). Nominatim échoue souvent sur les
// chaînes verbeuses qui mélangent immeuble + apt + ville — le fallback
// récupère au moins un point dans la ville pour le scoring géo.

interface NominatimItem { lat: string; lon: string }

async function geocodeOnce(query: string): Promise<{ lat: number; lng: number } | null> {
  if (!query.trim()) return null;
  try {
    const url = `${NOMINATIM_API}?format=json&limit=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'foxo-app/1.0 (info@foxo.be)',
        'Accept-Language': 'fr-BE,fr;q=0.9',
      },
    });
    if (!res.ok) return null;
    const items = (await res.json()) as NominatimItem[];
    if (!items[0]) return null;
    const lat = Number.parseFloat(items[0].lat);
    const lng = Number.parseFloat(items[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

function stripVerboseAddressTokens(address: string): string {
  let s = ` ${address} `;
  // Strip "Résidence X" / "Résidence X," / "Résidence X —"
  s = s.replace(/\bRésidence\s+[\w\d-]+\s*[,—–-]?\s*/gi, ' ');
  // Strip "Appartement / Apt / App + identifiant"
  s = s.replace(/\b(?:Appartement|App?\.?)\s+[\w\d-]+\s*[,—–-]?\s*/gi, ' ');
  // Strip "Bât / Bâtiment + identifiant"
  s = s.replace(/\b(?:Bâtiment|Bâ?t\.?)\s+[\w\d-]+\s*[,—–-]?\s*/gi, ' ');
  // Strip "Étage N"
  s = s.replace(/\bÉtage\s+[\w\d-]+\s*[,—–-]?\s*/gi, ' ');
  // Compact spaces & comma artifacts
  s = s.replace(/,\s*,/g, ',').replace(/\s+/g, ' ').trim().replace(/^,|,$/g, '').trim();
  return s;
}

function lastSegment(address: string): string {
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  // Tentative 1 — adresse complète, telle qu'extraite par Claude.
  const t1 = await geocodeOnce(address);
  console.log(`[analyse-deep] geocoding attempt 1: "${address}" →`, t1);
  if (t1) return t1;

  // Tentative 2 — strip des tokens verbeux (Résidence/Apt/Bât/Étage).
  const cleaned = stripVerboseAddressTokens(address);
  if (cleaned && cleaned !== address.trim()) {
    const t2 = await geocodeOnce(cleaned);
    console.log(`[analyse-deep] geocoding attempt 2: "${cleaned}" →`, t2);
    if (t2) return t2;
  }

  // Tentative 3 — dernier segment (ville seule).
  const ville = lastSegment(cleaned || address);
  if (ville && ville !== (cleaned || address).trim()) {
    const t3 = await geocodeOnce(ville);
    console.log(`[analyse-deep] geocoding attempt 3: "${ville}" →`, t3);
    if (t3) return t3;
  }

  return null;
}

// ─── Handler ──────────────────────────────────────────────────────────

interface AnalyseDeepBody {
  thread_id?: unknown;
}

export async function POST(request: Request) {
  // 1. Guard admin
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ success: false, error: 'Accès refusé.' }, { status: 401 });
  }

  let body: AnalyseDeepBody;
  try {
    body = (await request.json()) as AnalyseDeepBody;
  } catch {
    return NextResponse.json({ success: false, error: 'JSON body invalide.' }, { status: 400 });
  }
  const threadId = typeof body.thread_id === 'string' ? body.thread_id.trim() : '';
  if (!threadId) {
    return NextResponse.json({ success: false, error: 'thread_id requis.' }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ success: false, error: 'ANTHROPIC_API_KEY manquante.' }, { status: 500 });
  }

  const errors: string[] = [];
  const admin = createAdminClient();

  try {
    // 2. Récupération thread Gmail (réutilise getEmailThread de @/lib/gmail
    //    — l'attachment_id est désormais inclus dans GmailAttachmentRef
    //    grâce au refacto fait en parallèle).
    const threadRes = await getEmailThread(threadId);
    if (!threadRes.ok) {
      return NextResponse.json({ success: false, error: threadRes.error }, { status: 502 });
    }
    const messages = threadRes.messages;
    if (messages.length === 0) {
      return NextResponse.json({ success: false, error: 'Thread vide ou inaccessible.' }, { status: 404 });
    }
    // Le builder GmailMessage tronque body_text à 4000 chars/message ;
    // pour 30 messages c'est ~120k chars max → safe pour Claude.
    const threadText = messages
      .map((m) => `--- Message du ${m.date} de ${m.from} ---\n${m.body_text}`)
      .join('\n\n');

    // 3. Contexte FoxO (parallèle)
    const [syndicsRes, dossiersRes] = await Promise.all([
      admin.from('organisations').select('nom, email').eq('type', 'syndic').limit(50),
      admin
        .from('interventions')
        .select('ref, adresse')
        .neq('statut', 'cloturee')
        .order('created_at', { ascending: false })
        .limit(5),
    ]);
    const syndicsList = (syndicsRes.data ?? [])
      .map((s) => {
        const email = (s as { email?: string | null }).email ?? '';
        const domain = email.split('@')[1] ?? '';
        const nom = (s as { nom?: string | null }).nom ?? '?';
        return `- ${nom}${domain ? ` (${domain})` : ''}`;
      })
      .join('\n');
    const dossiersList = (dossiersRes.data ?? [])
      .map((d) => {
        const ref = (d as { ref?: string | null }).ref ?? '?';
        const adr = (d as { adresse?: string | null }).adresse ?? '?';
        return `- ${ref} : ${adr}`;
      })
      .join('\n');

    // 4. Appel Claude API
    const systemPrompt = [
      `IMPÉRATIF : ta réponse complète DOIT être uniquement un objet JSON valide. Aucun texte avant. Aucun texte après. Aucun markdown. Aucune balise \`\`\`. Commence directement par { et termine par }.`,
      ``,
      `Tu es l'assistant de FoxO, société belge de détection de fuites non destructive.`,
      ``,
      `Tu analyses un mail entrant et tu retournes UNIQUEMENT du JSON valide (aucun markdown, aucun texte autour).`,
      ``,
      `Schéma de sortie strict :`,
      `{`,
      `  "type": "demande_intervention" | "relance_rapport" | "suivi_dossier" | "question_generale" | "accuse_reception" | "spam_commercial",`,
      `  "type_intervention": "Fuite canalisation" | "Fuite chauffage" | "Fuite infiltration" | "Surconsommation eau" | "Autre",`,
      `  "urgence": boolean,`,
      `  "langue": "fr" | "nl" | "en" | "other",`,
      `  "adresse_extraite": string | null,`,
      `  "numero_dossier_mentionne": string | null,`,
      `  "resume": string,`,
      `  "occupant_telephone": string | null,`,
      `  "occupant_email": string | null`,
      `}`,
      ``,
      `Règles :`,
      `- type_intervention : déduire du contenu. "Infiltration plafond" / "tâches d'humidité" → "Fuite infiltration". "fuite chaudière" / "radiateur" / "chauffage" → "Fuite chauffage". "compteur eau" / "consommation anormale" → "Surconsommation eau". "tuyau" / "canalisation" / "sanitaire" → "Fuite canalisation". Si doute → "Autre".`,
      `- urgence=true si "fuite active", "dégât en cours", "urgent", "rapidement", "asap"`,
      ``,
      `- adresse_extraite : DOIT être au format postal belge strict`,
      `   "Type-voie Nom Numéro, Code-postal Ville"`,
      `  Exemples valides :`,
      `   - "Avenue Henri Liebrecht 66, 1090 Bruxelles"`,
      `   - "Rue de la Loi 16, 1000 Bruxelles"`,
      `   - "Chaussée de Charleroi 145, 1060 Bruxelles"`,
      ``,
      `  INTERDIT (mettre null) :`,
      `   - Noms commerciaux : "Résidence Greenwood", "Tour des Pins"`,
      `   - Adresses partielles : "F4, Bruxelles", "Appartement 12"`,
      `   - Lieux génériques : "Bruxelles", "chez le client"`,
      ``,
      `  Cherche dans :`,
      `   - Le corps du mail (priorité)`,
      `   - La signature (souvent en bas)`,
      `   - Les forwards inclus dans le thread`,
      ``,
      `  Si aucune adresse postale complète n'est trouvée, mets null.`,
      `  Ne JAMAIS deviner ni reformater un nom de résidence en adresse.`,
      ``,
      `- numero_dossier_mentionne : pattern "2026-XXX" ou null`,
      `- resume : max 200 caractères, en français`,
      `- Si forward avec historique, considère le contexte complet du thread`,
      ``,
      `Syndics connus (pour info matching) :`,
      syndicsList || '(aucun)',
      ``,
      `Dossiers actifs récents :`,
      dossiersList || '(aucun)',
    ].join('\n');

    // 4-6. Appel Claude + parsing JSON + matching dossier sous observabilité.
    //      runAgent mesure tokens/coût/durée, insère agent_logs, et propage
    //      l'override interventionId quand le matching dossier réussit (CAS A
    //      — modif 3b1). Le JSON parse fail est re-throw avec préfixe
    //      "JSON parse: " + preview ; le wrapper logge tel quel.
    const client = new Anthropic({ apiKey });
    let analyse: ClaudeAnalyse;
    let dossierMatchId: string | null = null;
    let dossierInfo: DossierInfo | null = null;
    let dossierExisted = false;
    let lat: number | null = null;
    let lng: number | null = null;

    try {
      const result = await runAgent<{
        classification: ClaudeAnalyse;
        matchedInterventionId: string | null;
        dossierInfo: DossierInfo | null;
        dossierExisted: boolean;
        lat: number | null;
        lng: number | null;
      }>({
        agentName: 'triage_mail',
        model: MODEL,
        emailId: null,
        inputSummary: {
          from_domain: messages[0]?.from?.match(/@([^>\s]+)/)?.[1] ?? null,
          message_count: messages.length,
          body_length: threadText.length,
        },
        run: async () => {
          // (i) Appel Anthropic
          const msg = await client.messages.create({
            model: MODEL,
            max_tokens: 1024,
            temperature: 0,
            system: systemPrompt,
            messages: [{ role: 'user', content: `Thread complet :\n${threadText}` }],
          });
          const block = msg.content[0];
          const rawText = block && block.type === 'text' ? block.text : '';

          // Log de la réponse brute (visible dans Vercel logs) pour pouvoir
          // diagnostiquer rapidement les drifts de format de Claude (fences,
          // préambules, etc.) sans avoir à reproduire le mail.
          console.log('[analyse-deep] raw response', rawText.slice(0, 300));

          // (ii) Parsing JSON strict — passe par extractJson qui supporte les
          //      fences ```json ... ``` et le bruit avant/après l'objet, malgré
          //      la consigne stricte du system prompt.
          let classification: ClaudeAnalyse;
          try {
            const cleaned = extractJson(rawText);
            classification = JSON.parse(cleaned) as ClaudeAnalyse;
          } catch (err) {
            const preview = rawText.slice(0, 200).replace(/\s+/g, ' ');
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error('[analyse-deep] JSON parse failed', {
              raw: rawText.slice(0, 500),
              error: errMsg,
            });
            throw new Error(`JSON parse: ${errMsg} (preview: ${preview})`);
          }

          // (iii) Matching dossier existant (lecture seule — analyse-deep ne
          //       crée plus de nouveau dossier ; dossier_created reste donc
          //       toujours false dans la réponse de cette route et passera à
          //       true via confirm-and-create après validation manuelle).
          let matchedInterventionId: string | null = null;
          let matchedInfo: DossierInfo | null = null;
          let matchedExisted = false;
          let matchedLat: number | null = null;
          let matchedLng: number | null = null;

          if (classification.numero_dossier_mentionne) {
            const { data } = await admin
              .from('interventions')
              .select('id, ref, adresse, lat, lng')
              .eq('ref', classification.numero_dossier_mentionne)
              .maybeSingle();
            if (data) {
              const d = data as { id: string; ref: string | null; adresse: string | null; lat: number | null; lng: number | null };
              matchedInterventionId = d.id;
              matchedInfo = { id: d.id, ref: d.ref, adresse: d.adresse };
              matchedExisted = true;
              matchedLat = d.lat;
              matchedLng = d.lng;
            }
          }
          if (!matchedInterventionId && classification.adresse_extraite) {
            const firstWords = classification.adresse_extraite.split(/\s+/).slice(0, 3).join(' ');
            const { data } = await admin
              .from('interventions')
              .select('id, ref, adresse, lat, lng')
              .ilike('adresse', `%${firstWords}%`)
              .neq('statut', 'cloturee')
              .limit(1)
              .maybeSingle();
            if (data) {
              const d = data as { id: string; ref: string | null; adresse: string | null; lat: number | null; lng: number | null };
              matchedInterventionId = d.id;
              matchedInfo = { id: d.id, ref: d.ref, adresse: d.adresse };
              matchedExisted = true;
              matchedLat = d.lat;
              matchedLng = d.lng;
            }
          }

          return {
            message: msg,
            output: {
              classification,
              matchedInterventionId,
              dossierInfo: matchedInfo,
              dossierExisted: matchedExisted,
              lat: matchedLat,
              lng: matchedLng,
            },
            outputSummary: {
              classified_type: classification.type ?? null,
              language_detected: classification.langue ?? null,
              urgency: classification.urgence ?? null,
              match_found: matchedInterventionId !== null,
            },
            interventionId: matchedInterventionId,
          };
        },
      });

      analyse = result.output.classification;
      dossierMatchId = result.output.matchedInterventionId;
      dossierInfo = result.output.dossierInfo;
      dossierExisted = result.output.dossierExisted;
      lat = result.output.lat;
      lng = result.output.lng;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'erreur inconnue';
      // Préserve les codes HTTP existants : 500 + raw_preview pour JSON
      // parse, 502 pour les autres erreurs (typiquement Anthropic SDK).
      if (errMsg.startsWith('JSON parse:')) {
        const previewMatch = errMsg.match(/\(preview: (.*)\)$/);
        const rawPreview = previewMatch ? previewMatch[1] : '';
        return NextResponse.json(
          {
            success: false,
            error: 'Claude a renvoyé un JSON invalide',
            raw_preview: rawPreview,
          },
          { status: 500 },
        );
      }
      return NextResponse.json(
        { success: false, error: `Anthropic : ${errMsg}` },
        { status: 502 },
      );
    }

    // 7. (LECTURE SEULE) Si demande_intervention sans match : géocoder
    //    pour scorer le créneau proposé. AUCUNE création Drive ni INSERT
    //    intervention ici — ces side-effects sont déférés à la route
    //    confirm-and-create, déclenchée après validation manuelle dans
    //    l'UI. Le but : proposer (analyse-deep) puis confirmer
    //    explicitement (admin) avant de toucher à la DB / Drive.
    if (analyse.type === 'demande_intervention' && !dossierMatchId && analyse.adresse_extraite) {
      const geo = await geocodeAddress(analyse.adresse_extraite);
      if (geo) {
        lat = geo.lat;
        lng = geo.lng;
      } else {
        errors.push('geocoding: aucun résultat Nominatim');
      }
    }

    // 8. (LECTURE SEULE) Pas de stockage de PJ ici — déféré à
    //    confirm-and-create qui a un dossier Drive cible.
    const pjUploaded = 0;

    // 9. Proposer un créneau (si demande_intervention)
    let creneauPropose: CreneauPropose | null = null;
    let creneauAlternative: CreneauPropose | null = null;
    let fenetreEtendue = false;
    if (analyse.type === 'demande_intervention') {
      try {
        const r = await proposeCreneau({
          adresse_lat: lat,
          adresse_lng: lng,
          urgence: analyse.urgence,
        });
        creneauPropose = r.primary;
        creneauAlternative = r.alternative;
        fenetreEtendue = r.fenetre_etendue;
      } catch (e) {
        errors.push(`proposeCreneau: ${e instanceof Error ? e.message : 'inconnu'}`);
      }
    }

    // 10. UPSERT mails_analyses (toujours, permet retry idempotent)
    try {
      // pj_drive_ids et brouillon_gmail_id / event_calendar_id NE SONT
      // PAS écrits ici — ils sont gérés respectivement par
      // confirm-and-create (uploads PJ post-validation) et
      // draft-reply / calendar/events. L'UPSERT préserve naturellement
      // les colonnes absentes du payload (Supabase upsert sémantique :
      // INSERT … ON CONFLICT DO UPDATE SET <colonnes du payload>).
      const upsertPayload: Record<string, unknown> = {
        thread_id: threadId,
        type: analyse.type,
        urgence: analyse.urgence,
        langue: analyse.langue,
        adresse_extraite: analyse.adresse_extraite,
        numero_dossier_mentionne: analyse.numero_dossier_mentionne,
        resume: analyse.resume,
        occupant_telephone: analyse.occupant_telephone,
        occupant_email: analyse.occupant_email,
        dossier_match_id: dossierMatchId,
        creneau_propose_id: creneauPropose?.creneau_id ?? null,
        fenetre_etendue: fenetreEtendue,
        analyse_raw: analyse,
        errors: errors.length > 0 ? errors : null,
        updated_at: new Date().toISOString(),
      };
      const { error: upErr } = await admin
        .from('mails_analyses')
        .upsert(upsertPayload, { onConflict: 'thread_id' });
      if (upErr) {
        errors.push(`upsert mails_analyses: ${upErr.message}`);
      }
    } catch (e) {
      errors.push(`upsert mails_analyses: ${e instanceof Error ? e.message : 'inconnu'}`);
    }

    // 11. Réponse enrichie. dossier_created/dossier_existed permettent à
    //     l'UI de différencier "Dossier 2026-XXX créé" (nouvelle entrée
    //     dans interventions) vs "Dossier 2026-XXX existant" (matché par
    //     ref ou ILIKE adresse).
    return NextResponse.json({
      success: true,
      analyse: {
        ...analyse,
        dossier: dossierInfo,
        // analyse-deep est read-only : dossier_created toujours false ici.
        // confirm-and-create renvoie dossier_created=true après validation.
        dossier_created: false,
        dossier_existed: dossierExisted,
        creneau_propose: creneauPropose,
        creneau_alternative: creneauAlternative,
        fenetre_etendue: fenetreEtendue,
        pj_uploaded: pjUploaded,
      },
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (e) {
    console.error('[analyse-deep] fatal:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Erreur interne' },
      { status: 500 },
    );
  }
}
