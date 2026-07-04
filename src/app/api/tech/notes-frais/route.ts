import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser, canAccessTechSpace } from "@/lib/auth/server";
import { getTauxKm } from '@/lib/facturation/bareme';
import type { CategorieNoteFrais, NoteFrais, StatutNoteFrais } from '@/lib/types/database';

export const dynamic = 'force-dynamic';

const ALLOWED_CATEGORIES = new Set<CategorieNoteFrais>([
  'carburant', 'materiel', 'outillage', 'transport',
  'restauration', 'fournitures', 'sous_traitance', 'autre',
]);
const ALLOWED_STATUTS = new Set<StatutNoteFrais>([
  'brouillon', 'soumise', 'approuvee', 'rejetee', 'remboursee',
]);

// Gate commun : tech (whitelist OU role DB) ou admin. Renvoie l'email
// + un boolean isAdmin pour les routes qui veulent élargir l'admin.
async function authorize(): Promise<
  | { ok: true; email: string; isAdmin: boolean }
  | { ok: false; status: number; error: string }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isAdmin = await isAdminUser();
  // Accès tech via le rôle DB (utilisateurs.role), pas une whitelist d'emails.
  // canAccessTechSpace autorise technicien ET admin (parité avec l'historique).
  if (!user || !(await canAccessTechSpace(user.id))) {
    return { ok: false, status: 403, error: 'Accès refusé.' };
  }
  return { ok: true, email: (user.email ?? '').toLowerCase(), isAdmin };
}

// GET /api/tech/notes-frais?statut=brouillon
//
// Liste les notes du tech connecté (filtre technicien_email = auth email).
// Query : statut (optionnel) restreint à un statut précis.
export async function GET(request: Request) {
  const auth = await authorize();
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const url = new URL(request.url);
  const statutRaw = url.searchParams.get('statut');
  const statut: StatutNoteFrais | null =
    statutRaw && ALLOWED_STATUTS.has(statutRaw as StatutNoteFrais)
      ? (statutRaw as StatutNoteFrais)
      : null;

  const admin = createAdminClient();
  let q = admin
    .from('notes_frais')
    .select('*')
    .eq('technicien_email', auth.email)
    .is('deleted_at', null)
    .order('date_depense', { ascending: false });
  if (statut) q = q.eq('statut', statut);

  const { data, error } = await q;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data: (data ?? []) as NoteFrais[] });
}

// POST /api/tech/notes-frais
//
// Body : { titre, categorie, montant_htva, taux_tva, montant_ttc,
//          fournisseur?, date_depense, description?, intervention_id?,
//          photo_url? }
//
// Crée une note en statut='brouillon'. technicien_email injecté depuis
// l'auth ; technicien_nom récupéré depuis utilisateurs (prenom + nom).
export async function POST(request: Request) {
  const auth = await authorize();
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }

  const titre = typeof body.titre === 'string' ? body.titre.trim() : '';
  const categorie = typeof body.categorie === 'string' ? body.categorie : '';
  let montant_htva = typeof body.montant_htva === 'number' ? body.montant_htva : Number(body.montant_htva);
  let taux_tva = typeof body.taux_tva === 'number' ? body.taux_tva : Number(body.taux_tva);
  let montant_ttc = typeof body.montant_ttc === 'number' ? body.montant_ttc : Number(body.montant_ttc);
  const date_depense = typeof body.date_depense === 'string' ? body.date_depense : '';
  // Indemnité kilométrique : le client envoie UNIQUEMENT la distance —
  // le montant est TOUJOURS calculé côté serveur (jamais confiance au client).
  const kmDistance =
    body.km_distance === undefined || body.km_distance === null
      ? null
      : typeof body.km_distance === 'number' ? body.km_distance : Number(body.km_distance);

  if (!titre) return NextResponse.json({ ok: false, error: 'Titre requis.' }, { status: 400 });
  if (!ALLOWED_CATEGORIES.has(categorie as CategorieNoteFrais)) {
    return NextResponse.json({ ok: false, error: 'Catégorie invalide.' }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date_depense)) {
    return NextResponse.json({ ok: false, error: 'date_depense doit être YYYY-MM-DD.' }, { status: 400 });
  }

  let kmTauxApplique: number | null = null;
  if (kmDistance != null) {
    if (categorie !== 'transport') {
      return NextResponse.json({ ok: false, error: 'L\'indemnité kilométrique est réservée à la catégorie Transport.' }, { status: 400 });
    }
    if (!Number.isFinite(kmDistance) || kmDistance <= 0 || kmDistance > 5000) {
      return NextResponse.json({ ok: false, error: 'Distance (km) invalide.' }, { status: 400 });
    }
    const bareme = await getTauxKm(date_depense);
    if (!bareme) {
      return NextResponse.json(
        { ok: false, error: 'Barème kilométrique non configuré — contactez l\'admin. En attendant, désactivez l\'indemnité km et saisissez le montant manuellement.' },
        { status: 400 },
      );
    }
    // Indemnité forfaitaire : pas de TVA (HTVA = TTC = km × taux).
    const round2 = (n: number) => Math.round(n * 100) / 100;
    kmTauxApplique = Number(bareme.taux_eur_km);
    montant_ttc = round2(kmDistance * kmTauxApplique);
    montant_htva = montant_ttc;
    taux_tva = 0;
    if (montant_ttc <= 0) {
      return NextResponse.json({ ok: false, error: 'Montant kilométrique calculé nul — vérifie la distance.' }, { status: 400 });
    }
  } else {
    if (!Number.isFinite(montant_htva) || montant_htva < 0) {
      return NextResponse.json({ ok: false, error: 'Montant HTVA invalide.' }, { status: 400 });
    }
    if (!Number.isFinite(montant_ttc) || montant_ttc <= 0) {
      return NextResponse.json({ ok: false, error: 'Montant TTC invalide.' }, { status: 400 });
    }
    if (!Number.isFinite(taux_tva) || taux_tva < 0 || taux_tva > 100) {
      return NextResponse.json({ ok: false, error: 'Taux TVA invalide.' }, { status: 400 });
    }
  }

  const admin = createAdminClient();

  // technicien_nom dénormalisé pour l'affichage admin sans jointure.
  const { data: u } = await admin
    .from('utilisateurs')
    .select('prenom, nom')
    .eq('email', auth.email)
    .maybeSingle();
  const technicien_nom = u
    ? [u.prenom, u.nom].filter((s): s is string => typeof s === 'string' && s.length > 0).join(' ') || null
    : null;

  const payload: Record<string, unknown> = {
    technicien_email: auth.email,
    technicien_nom,
    titre,
    categorie,
    montant_htva,
    taux_tva,
    montant_ttc,
    date_depense,
    statut: 'brouillon' as const,
    fournisseur:     typeof body.fournisseur === 'string' && body.fournisseur ? body.fournisseur : null,
    description:     typeof body.description === 'string' && body.description ? body.description : null,
    intervention_id: typeof body.intervention_id === 'string' && body.intervention_id ? body.intervention_id : null,
    photo_url:       typeof body.photo_url === 'string' && body.photo_url ? body.photo_url : null,
    km_distance:     kmDistance,
    km_taux_applique: kmTauxApplique,
  };

  const { data, error } = await admin
    .from('notes_frais')
    .insert(payload)
    .select()
    .single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data: data as NoteFrais });
}
