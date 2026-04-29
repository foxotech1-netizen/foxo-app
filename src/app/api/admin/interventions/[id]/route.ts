import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { roleForEmail } from '@/lib/auth/roles';
import type { ParticulierContact, StatutIntervention } from '@/lib/types/database';

export const dynamic = 'force-dynamic';

const ALLOWED_TYPES = [
  'Fuite canalisation',
  'Fuite chauffage',
  'Fuite infiltration',
  'Surconsommation eau',
  'Autre',
] as const;

interface PatchBody {
  ref?: unknown;                 // YYYY-NNN
  nom_client?: unknown;          // → particulier_contact prenom + nom + nom_complet + mandant
  adresse?: unknown;             // → intervention.adresse + particulier_contact.{adresse_intervention, lieu, mandant.adresse_facturation}
  type?: unknown;
  telephone?: unknown;           // → particulier_contact.telephone + .mandant.tel
  email?: unknown;               // → particulier_contact.email + .mandant.email
  description?: unknown;         // notes
  priorite?: unknown;
}

const REF_RE = /^\d{4}-\d{3,5}$/;

function splitName(full: string): { prenom: string; nom: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length >= 2) return { prenom: parts[0], nom: parts.slice(1).join(' ') };
  return { prenom: '', nom: full.trim() };
}

function parseAdresse(s: string): { rue: string; cp: string; ville: string } {
  const m = s.match(/^(.+?),?\s*(\d{4})\s+(.+?)$/);
  if (m) return { rue: m[1].trim(), cp: m[2].trim(), ville: m[3].trim() };
  return { rue: s.trim(), cp: '', ville: '' };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { id } = await params;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }

  // Charge l'intervention courante pour merger particulier_contact
  const { data: current, error: loadErr } = await supabase
    .from('interventions')
    .select('id, particulier_contact, adresse, type, description, priorite')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ ok: false, error: loadErr.message }, { status: 500 });
  if (!current) return NextResponse.json({ ok: false, error: 'Intervention introuvable.' }, { status: 404 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const pc = (current.particulier_contact as ParticulierContact | null) ?? null;
  let nextPc: ParticulierContact | null = pc ? { ...pc } : null;

  function ensurePc(): ParticulierContact {
    if (!nextPc) {
      nextPc = {
        prenom: '',
        nom: '',
        email: '',
        telephone: '',
        adresse: { rue: '', code_postal: '', ville: '' },
        mandant: { prenom: '', nom: '', email: '', tel: '', adresse_facturation: { rue: '', code_postal: '', ville: '' } },
        lieu: { meme_que_mandant: true, rue: '', cp: '', ville: '' },
        contact_sur_place: { actif: false },
      } as ParticulierContact;
    }
    return nextPc;
  }

  // ── champs intervention.* ─────────────────────────────────────────────
  if (typeof body.ref === 'string') {
    if (!REF_RE.test(body.ref)) {
      return NextResponse.json({ ok: false, error: 'Format de référence invalide (YYYY-NNN).' }, { status: 400 });
    }
    patch.ref = body.ref;
  }
  if (typeof body.type === 'string') {
    if (!(ALLOWED_TYPES as readonly string[]).includes(body.type)) {
      return NextResponse.json({ ok: false, error: 'Type non autorisé.' }, { status: 400 });
    }
    patch.type = body.type;
  }
  if (typeof body.description === 'string') patch.description = body.description;
  if (typeof body.priorite === 'string') {
    if (body.priorite !== 'normale' && body.priorite !== 'urgente') {
      return NextResponse.json({ ok: false, error: 'Priorité invalide.' }, { status: 400 });
    }
    patch.priorite = body.priorite;
  }

  // ── champs synchronisés intervention + particulier_contact ──────────
  if (typeof body.nom_client === 'string') {
    const { prenom, nom } = splitName(body.nom_client);
    const pcRef = ensurePc();
    pcRef.prenom = prenom;
    pcRef.nom = nom;
    if (pcRef.mandant) {
      pcRef.mandant.prenom = prenom;
      pcRef.mandant.nom = nom;
    }
    // nom_complet est utilisé par le rendu drawer ; on l'ajoute en extra
    (pcRef as unknown as { nom_complet: string }).nom_complet = body.nom_client;
  }

  if (typeof body.adresse === 'string') {
    patch.adresse = body.adresse || null;
    const adr = parseAdresse(body.adresse);
    const pcRef = ensurePc();
    pcRef.adresse = { rue: adr.rue, code_postal: adr.cp, ville: adr.ville };
    if (pcRef.lieu) {
      pcRef.lieu.rue = adr.rue;
      pcRef.lieu.cp = adr.cp;
      pcRef.lieu.ville = adr.ville;
      pcRef.lieu.meme_que_mandant = true;
    }
    if (pcRef.mandant?.adresse_facturation) {
      pcRef.mandant.adresse_facturation.rue = adr.rue;
      pcRef.mandant.adresse_facturation.code_postal = adr.cp;
      pcRef.mandant.adresse_facturation.ville = adr.ville;
    }
    (pcRef as unknown as { adresse_intervention: string }).adresse_intervention = body.adresse;
  }

  if (typeof body.telephone === 'string') {
    const pcRef = ensurePc();
    pcRef.telephone = body.telephone;
    if (pcRef.mandant) pcRef.mandant.tel = body.telephone;
  }

  if (typeof body.email === 'string') {
    const pcRef = ensurePc();
    pcRef.email = body.email;
    if (pcRef.mandant) pcRef.mandant.email = body.email;
  }

  if (nextPc !== pc) {
    patch.particulier_contact = nextPc;
  }

  if (Object.keys(patch).length === 1) {
    // Seulement updated_at — rien à faire
    return NextResponse.json({ ok: true, no_changes: true });
  }

  const { error } = await supabase
    .from('interventions')
    .update(patch)
    .eq('id', id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

// ─── DELETE — suppression d'intervention en cascade ──────────────────────
//
// Garde-fou : statut doit être 'nouvelle' | 'attente' | 'en_suspens'.
// Au-delà (confirmee, realisee, rapport, cloturee) on bloque côté serveur
// même si l'UI cache le bouton — défense en profondeur.
//
// Cascade manuelle (les FK ne sont pas toutes en ON DELETE CASCADE) :
//   - intervention_timeline
//   - sms_logs
//   - photos_interventions
//   - occupants
//   - creneaux_disponibles  (libère le créneau réservé)
//   - interventions
const DELETABLE_STATUTS: StatutIntervention[] = ['nouvelle', 'attente', 'en_suspens'];

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }
  const { id } = await params;

  // Vérifie le statut (lecture user — RLS appliquée)
  const { data: iv, error: loadErr } = await supabase
    .from('interventions')
    .select('id, ref, statut')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ ok: false, error: loadErr.message }, { status: 500 });
  if (!iv) return NextResponse.json({ ok: false, error: 'Intervention introuvable.' }, { status: 404 });
  const row = iv as { id: string; ref: string | null; statut: StatutIntervention };
  if (!DELETABLE_STATUTS.includes(row.statut)) {
    return NextResponse.json(
      { ok: false, error: `Impossible de supprimer une intervention au statut "${row.statut}".` },
      { status: 403 },
    );
  }

  // Suppression cascade — admin client pour bypass RLS sur les tables enfants
  // (certaines policies permettent SELECT mais pas DELETE pour l'admin user
  // selon la config). Best-effort : on ne fail pas si une table enfant est
  // vide. On stoppe seulement si la suppression de l'intervention elle-même
  // échoue.
  const admin = createAdminClient();

  await admin.from('intervention_timeline').delete().eq('intervention_id', id);
  await admin.from('sms_logs').delete().eq('intervention_id', id);
  await admin.from('photos_interventions').delete().eq('intervention_id', id);
  await admin.from('occupants').delete().eq('intervention_id', id);

  // Libère un créneau réservé (statut → libre, intervention_id → null)
  await admin
    .from('creneaux_disponibles')
    .update({ statut: 'libre', intervention_id: null })
    .eq('intervention_id', id);

  const { error: delErr } = await admin
    .from('interventions')
    .delete()
    .eq('id', id);
  if (delErr) {
    return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deleted_ref: row.ref });
}
