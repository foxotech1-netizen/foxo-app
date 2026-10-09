'use server';

import { headers } from 'next/headers';
import { after } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRdvRateLimit, getRequestIp, recordRdvAttempt } from '@/lib/rate-limit';
import { sendRdvConfirmation, sendRdvAdminNotification, type RdvEmailData } from '@/lib/email/rdv';
import { nextRefForYear } from '@/lib/intervention-ref';

export type RdvSubmitResult =
  | { ok: true; data: { ref: string; interventionId: string } }
  | { ok: false; error: string; rateLimited?: boolean };

const TYPES_VALIDES = [
  'Fuite canalisation',
  'Fuite chauffage',
  'Fuite infiltration',
  'Surconsommation eau',
  'Autre',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\d\s+().-]{6,}$/;
const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

type ParsedData = {
  // Mandant (facturation)
  prenom: string;
  nom: string;
  email: string;
  telephone: string;
  rue: string;            // adresse facturation
  code_postal: string;
  ville: string;
  bce: string;            // optionnel
  // Lieu intervention
  lieu_meme: boolean;
  lieu_rue: string;
  lieu_cp: string;
  lieu_ville: string;
  // Contact sur place
  contact_actif: boolean;
  contact_prenom: string;
  contact_nom: string;
  contact_tel: string;
  contact_email: string;
  contact_instr: string;
  // Problème
  type: string;
  description: string;
  priorite: 'normale' | 'urgente';
  creneauIso: string | null;
  // Identifiant généré par le navigateur, identique à chaque nouvel essai du
  // même formulaire : permet de reconnaître une demande déjà enregistrée.
  submissionId: string | null;
};

function parseData(raw: unknown): ParsedData | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Données invalides.' };
  const r = raw as Record<string, unknown>;
  const get = (k: string): string => (typeof r[k] === 'string' ? (r[k] as string).trim() : '');
  const getBool = (k: string): boolean => Boolean(r[k]);

  const prenom = get('prenom');
  const nom = get('nom');
  const email = get('email').toLowerCase();
  const telephone = get('telephone');
  const rue = get('rue');
  const code_postal = get('code_postal');
  const ville = get('ville');
  const bce = get('bce');

  const lieu_meme = getBool('lieu_meme');
  const lieu_rue = lieu_meme ? rue : get('lieu_rue');
  const lieu_cp = lieu_meme ? code_postal : get('lieu_cp');
  const lieu_ville = lieu_meme ? ville : get('lieu_ville');

  const contact_actif = getBool('contact_actif');
  const contact_prenom = contact_actif ? get('contact_prenom') : '';
  const contact_nom = contact_actif ? get('contact_nom') : '';
  const contact_tel = contact_actif ? get('contact_tel') : '';
  const contact_email = contact_actif ? get('contact_email').toLowerCase() : '';
  const contact_instr = contact_actif ? get('contact_instr') : '';

  const type = get('type');
  const description = get('description');
  const priorite = get('priorite');
  const creneauIso = get('creneauIso') || null;
  const submissionRaw = get('submission_id');
  const submissionId = /^[A-Za-z0-9-]{8,64}$/.test(submissionRaw) ? submissionRaw : null;

  if (!prenom || !nom) return { error: 'Prénom et nom sont obligatoires.' };
  if (!EMAIL_RE.test(email)) return { error: 'Email invalide.' };
  if (!PHONE_RE.test(telephone)) return { error: 'Téléphone invalide.' };
  if (!rue || !code_postal || !ville) return { error: 'Adresse de facturation complète obligatoire.' };
  if (!lieu_meme && (!lieu_rue || !lieu_cp || !lieu_ville)) {
    return { error: 'Adresse d\'intervention complète obligatoire.' };
  }
  if (contact_actif) {
    if (!contact_prenom || !contact_nom) return { error: 'Prénom + nom du contact sur place requis.' };
    if (!contact_tel) return { error: 'Téléphone du contact sur place requis.' };
    if (contact_email && !EMAIL_RE.test(contact_email)) return { error: 'Email du contact sur place invalide.' };
  }
  if (!TYPES_VALIDES.includes(type)) return { error: 'Type d\'intervention invalide.' };
  if (description.length < 10) return { error: 'Description trop courte (10 caractères minimum).' };
  if (priorite !== 'normale' && priorite !== 'urgente') return { error: 'Priorité invalide.' };
  if (creneauIso) {
    const d = new Date(creneauIso);
    if (Number.isNaN(d.getTime())) return { error: 'Créneau invalide.' };
  }

  return {
    prenom, nom, email, telephone, rue, code_postal, ville, bce,
    lieu_meme, lieu_rue, lieu_cp, lieu_ville,
    contact_actif, contact_prenom, contact_nom, contact_tel, contact_email, contact_instr,
    type, description, priorite, creneauIso, submissionId,
  };
}

// Point d'entrée public. Ne lève JAMAIS : toute erreur imprévue devient un
// message affiché dans le formulaire (avant : page d'erreur générique de
// Next, formulaire perdu, alors que le dossier pouvait déjà être créé).
export async function submitRdv(formData: FormData): Promise<RdvSubmitResult> {
  try {
    return await submitRdvInner(formData);
  } catch (e) {
    console.error('[rdv] submitRdv — exception non prévue :', e);
    return {
      ok: false,
      error: 'Un problème technique est survenu. Réessayez dans un instant : votre demande ne sera pas enregistrée deux fois.',
    };
  }
}

async function submitRdvInner(formData: FormData): Promise<RdvSubmitResult> {
  // 1. Parse données JSON
  const dataRaw = formData.get('data');
  if (typeof dataRaw !== 'string') return { ok: false, error: 'Payload invalide.' };
  let parsedJson: unknown;
  try { parsedJson = JSON.parse(dataRaw); } catch { return { ok: false, error: 'JSON invalide.' }; }

  const parsed = parseData(parsedJson);
  if ('error' in parsed) return { ok: false, error: parsed.error };

  // 2. Photos depuis FormData (clés photo_0, photo_1, …)
  const photos: File[] = [];
  for (const [k, v] of formData.entries()) {
    if (k.startsWith('photo_') && v instanceof File && v.size > 0) photos.push(v);
  }
  if (photos.length > MAX_PHOTOS) {
    return { ok: false, error: `Maximum ${MAX_PHOTOS} photos.` };
  }
  for (const p of photos) {
    if (p.size > MAX_PHOTO_BYTES) {
      return { ok: false, error: `Photo "${p.name}" trop lourde (max 3 MB).` };
    }
    if (!p.type.startsWith('image/')) {
      return { ok: false, error: `Fichier "${p.name}" : seules les images sont acceptées.` };
    }
  }

  // 3. Service-role obligatoire : aucune session côté client, RLS bloque
  // les anon. La validation des champs au-dessus est notre garde.
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: 'Configuration serveur incomplète (SUPABASE_SERVICE_ROLE_KEY absente).' };
  }

  // 3-bis. Anti-doublon : si cette même soumission (identifiant généré par
  // le navigateur) a déjà créé un dossier — réponse perdue, délai dépassé,
  // second clic — on renvoie le dossier existant comme un succès au lieu
  // d'en créer un second. Vérifié AVANT le rate limit : un nouvel essai
  // légitime ne doit pas être refusé. Best-effort : en cas d'erreur de
  // lecture, on poursuit normalement.
  if (parsed.submissionId) {
    const { data: deja } = await admin
      .from('interventions')
      .select('id, ref')
      .eq('particulier_contact->>submission_id', parsed.submissionId)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();
    if (deja?.id && deja.ref) {
      return { ok: true, data: { ref: deja.ref as string, interventionId: deja.id as string } };
    }
  }

  // 4. Rate limit par IP
  const h = await headers();
  const ip = getRequestIp(h);
  const rl = await checkRdvRateLimit(ip);
  if (!rl.ok) {
    return {
      ok: false,
      error: `Trop de demandes — réessayez dans ${rl.retryAfterMin} minutes.`,
      rateLimited: true,
    };
  }

  // L'adresse "intervention" peut différer de la facturation (mandant).
  const lieuRue = parsed.lieu_meme ? parsed.rue : parsed.lieu_rue;
  const lieuCp = parsed.lieu_meme ? parsed.code_postal : parsed.lieu_cp;
  const lieuVille = parsed.lieu_meme ? parsed.ville : parsed.lieu_ville;
  const adresseInterventionFmt = `${lieuRue}, ${lieuCp} ${lieuVille}`;

  // particulier_contact : nouvelle structure étendue + champs aplatis
  // (rétrocompatibilité avec emails/PDFs existants qui lisent prenom, nom,
  // email, telephone, adresse au top-level).
  const particulierContact = {
    ...(parsed.submissionId ? { submission_id: parsed.submissionId } : {}),
    prenom: parsed.prenom,
    nom: parsed.nom,
    email: parsed.email,
    telephone: parsed.telephone,
    adresse: {
      rue: lieuRue,                 // adresse d'intervention pour compat
      code_postal: lieuCp,
      ville: lieuVille,
    },
    mandant: {
      prenom: parsed.prenom,
      nom: parsed.nom,
      email: parsed.email,
      tel: parsed.telephone,
      adresse_facturation: {
        rue: parsed.rue,
        code_postal: parsed.code_postal,
        ville: parsed.ville,
      },
      ...(parsed.bce ? { bce: parsed.bce } : {}),
    },
    lieu: {
      meme_que_mandant: parsed.lieu_meme,
      rue: lieuRue,
      cp: lieuCp,
      ville: lieuVille,
    },
    contact_sur_place: {
      actif: parsed.contact_actif,
      ...(parsed.contact_actif ? {
        prenom: parsed.contact_prenom,
        nom: parsed.contact_nom,
        tel: parsed.contact_tel,
        ...(parsed.contact_email ? { email: parsed.contact_email } : {}),
        ...(parsed.contact_instr ? { instructions: parsed.contact_instr } : {}),
      } : {}),
    },
  };

  // Référence allouée par nextRefForYear (MAX base + Drive). Deux demandes
  // simultanées peuvent obtenir la même : l'INSERT échoue alors en 23505
  // (unicité de la ref) — on recalcule et on retente UNE fois.
  const insertWithRef = (r: string) => admin
    .from('interventions')
    .insert({
      ref: r,
      statut: 'nouvelle',
      priorite: parsed.priorite,
      type: parsed.type,
      description: parsed.description,
      creneau_debut: parsed.creneauIso,
      adresse: adresseInterventionFmt,
      date_demande: new Date().toISOString().slice(0, 10),
      demandeur_type: 'particulier',
      particulier_contact: particulierContact,
    })
    .select('id')
    .single();

  let ref = await nextRefForYear();
  let { data: iv, error: ivErr } = await insertWithRef(ref);
  if (ivErr && (ivErr as { code?: string }).code === '23505') {
    // La collision peut venir de CETTE MÊME demande, envoyée deux fois en
    // parallèle (nouvel essai pendant que le premier est encore en cours) :
    // on re-vérifie donc l'identifiant de soumission avant de recalculer une
    // référence — sinon le second essai créerait un second dossier.
    if (parsed.submissionId) {
      const { data: deja } = await admin
        .from('interventions')
        .select('id, ref')
        .eq('particulier_contact->>submission_id', parsed.submissionId)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle();
      if (deja?.id && deja.ref) {
        return { ok: true, data: { ref: deja.ref as string, interventionId: deja.id as string } };
      }
    }
    ref = await nextRefForYear();
    ({ data: iv, error: ivErr } = await insertWithRef(ref));
  }

  if (ivErr || !iv) {
    console.error('[rdv] insert intervention KO :', ivErr?.message);
    return { ok: false, error: 'Votre demande n\'a pas pu être enregistrée. Réessayez dans un instant ou contactez-nous par téléphone.' };
  }
  const interventionId = iv.id as string;

  // 5. Upload des photos (best-effort — n'échoue pas la demande si KO)
  if (photos.length > 0) {
    for (const file of photos) {
      try {
        const ts = Date.now();
        const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? '.jpg').toLowerCase();
        const safeName = `${ts}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, 40)}${ext.includes('.') ? '' : ext}`;
        const path = `${interventionId}/${safeName}`;
        const buf = Buffer.from(await file.arrayBuffer());
        const { error: upErr } = await admin.storage
          .from('intervention-photos')
          .upload(path, buf, { contentType: file.type, upsert: false });
        if (upErr) console.warn('[rdv] photo upload failed:', upErr.message);
      } catch (e) {
        console.warn('[rdv] photo upload error:', e);
      }
    }
  }

  // 6. Enregistre l'attempt rate-limit (après succès)
  await recordRdvAttempt(ip);

  // 7. Emails (best-effort) — envoyés APRÈS la réponse (after) : les deux
  // envois Gmail (avec rafraîchissement OAuth éventuel) ne retardent plus la
  // confirmation à l'écran et ne peuvent plus faire dépasser le délai de la
  // requête. Tout échec est journalisé, jamais remonté au client.
  const emailData: RdvEmailData = {
    ref,
    prenom: parsed.prenom,
    nom: parsed.nom,
    email: parsed.email,
    telephone: parsed.telephone,
    adresse: adresseInterventionFmt,
    type: parsed.type,
    description: parsed.description,
    priorite: parsed.priorite,
    creneauIso: parsed.creneauIso,
  };
  after(async () => {
    try {
      const [clientRes, adminRes] = await Promise.all([
        sendRdvConfirmation(emailData),
        sendRdvAdminNotification(emailData),
      ]);
      if (!clientRes.ok) console.warn('[rdv] client email failed:', clientRes.error);
      if (!adminRes.ok) console.warn('[rdv] admin email failed:', adminRes.error);
    } catch (e) {
      console.error('[rdv] envoi des mails — exception :', e);
    }
  });

  return { ok: true, data: { ref, interventionId } };
}
