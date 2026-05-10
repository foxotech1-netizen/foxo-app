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
import { getEmailThread, downloadGmailAttachment } from '@/lib/gmail';
import { proposeCreneau, type CreneauPropose } from '@/lib/mails/propose-creneau';
import {
  createInterventionFolderFromMail,
  uploadAttachmentToFolder,
} from '@/lib/drive/create-intervention-folder';

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

// Aligné sur l'enum interventions.type côté DB (NOT NULL, ne pas
// inventer de nouvelles valeurs sans ALTER TYPE). 'Autre' sert de
// fallback safe si Claude hésite ou si l'intent n'est pas clair.
type TypeIntervention =
  | 'Fuite canalisation'
  | 'Fuite chauffage'
  | 'Fuite infiltration'
  | 'Surconsommation eau'
  | 'Autre';

const ALLOWED_TYPES: TypeIntervention[] = [
  'Fuite canalisation',
  'Fuite chauffage',
  'Fuite infiltration',
  'Surconsommation eau',
  'Autre',
];

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
      `- type_intervention : déduire du contenu du mail. "infiltration" / "fuite plafond" / "tâches d'humidité" → "Fuite infiltration". "fuite chaudière" / "radiateur" / "chauffage" → "Fuite chauffage". "compteur eau" / "consommation anormale" → "Surconsommation eau". "tuyau" / "canalisation" / "sanitaire" → "Fuite canalisation". Si doute → "Autre".`,
      `- urgence=true si "fuite active", "dégât en cours", "urgent", "rapidement", "asap"`,
      `- adresse_extraite au format "Rue X N°, Ville" ou null si rien d'identifiable`,
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

    const client = new Anthropic({ apiKey });
    let claudeRaw: string;
    try {
      const msg = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: `Thread complet :\n${threadText}` }],
      });
      const block = msg.content[0];
      claudeRaw = block && block.type === 'text' ? block.text : '';
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'erreur inconnue';
      return NextResponse.json(
        { success: false, error: `Anthropic : ${errMsg}` },
        { status: 502 },
      );
    }

    // Log de la réponse brute (visible dans Vercel logs) pour pouvoir
    // diagnostiquer rapidement les drifts de format de Claude (fences,
    // préambules, etc.) sans avoir à reproduire le mail.
    console.log('[analyse-deep] raw response', claudeRaw.slice(0, 300));

    // 5. Parsing JSON strict — passe par extractJson qui supporte les
    //    fences ```json ... ``` et le bruit avant/après l'objet, malgré
    //    la consigne stricte du system prompt.
    let analyse: ClaudeAnalyse;
    try {
      const cleaned = extractJson(claudeRaw);
      analyse = JSON.parse(cleaned) as ClaudeAnalyse;
    } catch (err) {
      console.error('[analyse-deep] JSON parse failed', {
        raw: claudeRaw.slice(0, 500),
        error: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json(
        {
          success: false,
          error: 'Claude a renvoyé un JSON invalide',
          raw_preview: claudeRaw.slice(0, 200),
        },
        { status: 500 },
      );
    }

    // 6. Matching dossier existant
    let dossierMatchId: string | null = null;
    let dossierInfo: DossierInfo | null = null;
    let dossierExisted = false;
    let dossierCreated = false;
    let lat: number | null = null;
    let lng: number | null = null;
    let driveFolderId: string | null = null;

    if (analyse.numero_dossier_mentionne) {
      const { data } = await admin
        .from('interventions')
        .select('id, ref, adresse, lat, lng, drive_folder_id')
        .eq('ref', analyse.numero_dossier_mentionne)
        .maybeSingle();
      if (data) {
        const d = data as { id: string; ref: string | null; adresse: string | null; lat: number | null; lng: number | null; drive_folder_id: string | null };
        dossierMatchId = d.id;
        dossierInfo = { id: d.id, ref: d.ref, adresse: d.adresse };
        dossierExisted = true;
        lat = d.lat;
        lng = d.lng;
        driveFolderId = d.drive_folder_id;
      }
    }
    if (!dossierMatchId && analyse.adresse_extraite) {
      const firstWords = analyse.adresse_extraite.split(/\s+/).slice(0, 3).join(' ');
      const { data } = await admin
        .from('interventions')
        .select('id, ref, adresse, lat, lng, drive_folder_id')
        .ilike('adresse', `%${firstWords}%`)
        .neq('statut', 'cloturee')
        .limit(1)
        .maybeSingle();
      if (data) {
        const d = data as { id: string; ref: string | null; adresse: string | null; lat: number | null; lng: number | null; drive_folder_id: string | null };
        dossierMatchId = d.id;
        dossierInfo = { id: d.id, ref: d.ref, adresse: d.adresse };
        dossierExisted = true;
        lat = d.lat;
        lng = d.lng;
        driveFolderId = d.drive_folder_id;
      }
    }

    // 7. Si demande_intervention sans match : géocoder + créer Drive + INSERT
    if (analyse.type === 'demande_intervention' && !dossierMatchId && analyse.adresse_extraite) {
      const geo = await geocodeAddress(analyse.adresse_extraite);
      if (geo) {
        lat = geo.lat;
        lng = geo.lng;
      } else {
        errors.push('geocoding: aucun résultat Nominatim');
      }

      let createdRef: string | null = null;
      try {
        const drive = await createInterventionFolderFromMail(analyse.adresse_extraite);
        driveFolderId = drive.folder_id;
        createdRef = drive.ref;
      } catch (e) {
        errors.push(`drive: ${e instanceof Error ? e.message : 'inconnu'}`);
      }

      // type intervention : déduit par Claude (type_intervention de l'analyse).
      // Validé contre l'enum DB ; fallback 'Autre' si valeur inconnue ou null —
      // évite la violation NOT NULL sur interventions.type.
      const typeFromClaude = analyse.type_intervention;
      const typeForInsert: TypeIntervention =
        typeFromClaude && ALLOWED_TYPES.includes(typeFromClaude)
          ? typeFromClaude
          : 'Autre';

      const insertPayload: Record<string, unknown> = {
        ref: createdRef,
        type: typeForInsert,
        adresse: analyse.adresse_extraite,
        lat,
        lng,
        drive_folder_id: driveFolderId,
        statut: 'nouvelle',
        source: 'mail',
        source_mail_id: threadId,
        description: analyse.resume,
        priorite: analyse.urgence ? 'urgente' : 'normale',
      };
      const { data: inserted, error: insErr } = await admin
        .from('interventions')
        .insert(insertPayload)
        .select('id, ref, adresse')
        .single();
      if (insErr) {
        errors.push(`insert intervention: ${insErr.message}`);
      } else if (inserted) {
        const ins = inserted as { id: string; ref: string | null; adresse: string | null };
        dossierMatchId = ins.id;
        dossierInfo = { id: ins.id, ref: ins.ref, adresse: ins.adresse };
        dossierCreated = true;
      }
    }

    // 8. Stocker pièces jointes (si dossier + drive_folder_id dispo)
    const pjDriveIds: string[] = [];
    let pjUploaded = 0;
    if (dossierMatchId && driveFolderId) {
      // Aplati : (message_id, attachment) — on a besoin du message_id pour
      // appeler /messages/{id}/attachments/{att_id}.
      const flat = messages.flatMap((m) => m.attachments.map((a) => ({ message_id: m.id, ...a })));
      for (const att of flat) {
        if (!att.attachment_id) continue;
        try {
          const data64 = await downloadGmailAttachment(att.message_id, att.attachment_id);
          if (!data64) {
            errors.push(`gmail attachment ${att.filename}: download échoué`);
            continue;
          }
          const up = await uploadAttachmentToFolder({
            folder_id: driveFolderId,
            filename: att.filename,
            mime_type: att.mime_type,
            data_base64: data64,
          });
          pjDriveIds.push(up.file_id);
          pjUploaded += 1;
        } catch (e) {
          errors.push(`upload pj ${att.filename}: ${e instanceof Error ? e.message : 'inconnu'}`);
        }
      }
    }

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
        pj_drive_ids: pjDriveIds,
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
        dossier_created: dossierCreated,
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
