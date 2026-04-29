import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { roleForEmail } from '@/lib/auth/roles';
import { updateCalendarEvent } from '@/lib/google-calendar';
import { nextRefForYear } from '@/lib/intervention-ref';

export const dynamic = 'force-dynamic';

const ALLOWED_TYPES = [
  'Fuite canalisation',
  'Fuite chauffage',
  'Fuite infiltration',
  'Surconsommation eau',
  'Autre',
] as const;
type IvType = typeof ALLOWED_TYPES[number];

interface ImportBody {
  event_id?: unknown;
  event_start_iso?: unknown;
  event_end_iso?: unknown;
  event_title?: unknown;
  event_description?: unknown;
  event_location?: unknown;
  type?: unknown;
  technicien_id?: unknown;
  adresse?: unknown;
  description?: unknown;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

  let body: ImportBody;
  try {
    body = (await request.json()) as ImportBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }

  const eventId = typeof body.event_id === 'string' ? body.event_id : '';
  const eventStartIso = typeof body.event_start_iso === 'string' ? body.event_start_iso : '';
  const eventTitle = typeof body.event_title === 'string' ? body.event_title : '';
  const eventDescription = typeof body.event_description === 'string' ? body.event_description : '';
  const typeRaw = typeof body.type === 'string' ? body.type : '';
  const type: IvType | '' = (ALLOWED_TYPES as readonly string[]).includes(typeRaw) ? (typeRaw as IvType) : '';
  const technicienId = typeof body.technicien_id === 'string' && body.technicien_id ? body.technicien_id : null;
  const adresse = typeof body.adresse === 'string' ? body.adresse.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';

  if (!eventId) return NextResponse.json({ ok: false, error: 'event_id requis.' }, { status: 400 });
  if (!eventStartIso) return NextResponse.json({ ok: false, error: 'event_start_iso requis.' }, { status: 400 });
  if (!type) return NextResponse.json({ ok: false, error: 'Type d\'intervention requis.' }, { status: 400 });
  if (!description) return NextResponse.json({ ok: false, error: 'Description requise.' }, { status: 400 });

  // Garde-fou — un même event ne doit pas être importé deux fois
  const admin = createAdminClient();
  if (eventDescription && /foxo-ref:[a-f0-9-]{36}/i.test(eventDescription)) {
    return NextResponse.json(
      { ok: false, error: 'Cet event a déjà été importé (tag foxo-ref détecté).' },
      { status: 409 },
    );
  }

  const ref = await nextRefForYear();

  // Contact particulier minimal — l'admin éditera s'il a plus d'info.
  // On reste sur demandeur_type='particulier' car le schema impose
  // syndic OU particulier.
  const particulierContact = {
    nom_complet: eventTitle || '(événement Calendar)',
    adresse_intervention: adresse,
    prenom: '',
    nom: eventTitle || '',
    email: '',
    telephone: '',
    adresse: { rue: adresse, code_postal: '', ville: '' },
    mandant: {
      prenom: '',
      nom: eventTitle || '',
      email: '',
      tel: '',
      adresse_facturation: { rue: adresse, code_postal: '', ville: '' },
    },
    lieu: { meme_que_mandant: true, rue: adresse, cp: '', ville: '' },
    contact_sur_place: { actif: false },
  };

  const { data: iv, error } = await admin
    .from('interventions')
    .insert({
      ref,
      statut: 'confirmee',
      priorite: 'normale',
      type,
      description,
      adresse: adresse || null,
      creneau_debut: eventStartIso,
      date_demande: new Date().toISOString().slice(0, 10),
      demandeur_type: 'particulier',
      particulier_contact: particulierContact,
      technicien_id: technicienId,
      source: 'calendar',
    })
    .select('id, ref')
    .single();

  if (error || !iv) {
    return NextResponse.json({ ok: false, error: error?.message ?? 'Insert failed' }, { status: 500 });
  }

  // PATCH la description de l'event Calendar pour ajouter le marqueur
  // de cross-référence. Si ça échoue (event supprimé, scope insuffisant),
  // on ne défait PAS l'intervention — l'admin pourra retagger plus tard.
  const newDescription = [
    eventDescription.trim(),
    eventDescription.trim() ? '\n---\n' : '',
    `foxo-ref:${iv.id}`,
    `FoxO — Importé comme intervention ${iv.ref} le ${new Date().toLocaleDateString('fr-BE')}`,
  ].filter(Boolean).join('\n');

  const updateRes = await updateCalendarEvent(eventId, { description: newDescription });

  return NextResponse.json({
    ok: true,
    intervention_id: iv.id,
    ref: iv.ref,
    calendar_updated: updateRes.ok,
    calendar_error: updateRes.ok ? null : updateRes.error,
  });
}
