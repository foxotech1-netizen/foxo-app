// GET /api/admin/search?q=...
// Réponse : { results: { interventions, occupants, clients, acps, organisations } }
//
// Recherche globale admin (« Mode Appel » phase 1) : 5 requêtes ILIKE en
// parallèle, 8 résultats max par catégorie, dossiers clôturés INCLUS (à la
// différence de /api/admin/interventions/search qui reste dédié aux
// autocompletes de liaison). Si la saisie contient un numéro de téléphone
// (≥ 6 chiffres), les occupants sont aussi cherchés sur telephone_digits
// (colonne générée chiffres seuls, cf. migration 2026-07-30).
// Lecture seule, aucun appel IA.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUser } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

const LIMIT = 8;

export interface SearchResults {
  interventions: {
    id: string; ref: string | null; reference_externe: string | null;
    adresse: string | null; statut: string; type: string | null;
    creneau_debut: string | null; syndic_id: string | null; acp_id: string | null;
  }[];
  occupants: {
    id: string; intervention_id: string; nom: string | null; prenom: string | null;
    telephone: string | null; email: string | null; appartement: string | null;
    intervention_ref: string | null;
  }[];
  clients: { id: string; nom: string; type: string | null; ville: string | null; bce: string | null }[];
  acps: { id: string; nom: string; adresse: string | null; ville: string | null; syndic_id_ref: string | null }[];
  organisations: { id: string; nom: string; type: string | null; email: string | null }[];
}

const EMPTY: SearchResults = { interventions: [], occupants: [], clients: [], acps: [], organisations: [] };

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await isAdminUser())) {
    return NextResponse.json({ error: 'Accès refusé.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const raw = (url.searchParams.get('q') ?? '').trim();
  if (raw.length < 2) return NextResponse.json({ results: EMPTY });

  // Neutralise les caractères qui cassent la syntaxe .or() de PostgREST.
  const q = raw.replace(/[,()]/g, ' ').trim();
  if (q.length < 2) return NextResponse.json({ results: EMPTY });

  // Détection numéro : ≥ 6 chiffres une fois les non-chiffres retirés →
  // recherche complémentaire sur occupants.telephone_digits.
  const digits = raw.replace(/\D/g, '');
  const qDigits = digits.length >= 6 ? digits : null;

  const admin = createAdminClient();
  const pattern = `%${q}%`;

  try {
    const occupantOr = [
      `nom.ilike.${pattern}`,
      `prenom.ilike.${pattern}`,
      `email.ilike.${pattern}`,
      ...(qDigits ? [`telephone_digits.ilike.%${qDigits}%`] : []),
    ].join(',');

    const [ivRes, occRes, cliRes, acpRes, orgRes] = await Promise.all([
      admin
        .from('interventions')
        .select('id, ref, reference_externe, adresse, statut, type, creneau_debut, syndic_id, acp_id')
        .is('deleted_at', null)
        .or(`ref.ilike.${pattern},reference_externe.ilike.${pattern},adresse.ilike.${pattern},description.ilike.${pattern}`)
        .order('created_at', { ascending: false })
        .limit(LIMIT),
      admin
        .from('occupants')
        .select('id, intervention_id, nom, prenom, telephone, email, appartement')
        .or(occupantOr)
        .order('created_at', { ascending: false })
        .limit(LIMIT),
      admin
        .from('clients')
        .select('id, nom, type, ville, bce')
        .or(`nom.ilike.${pattern},bce.ilike.${pattern},email.ilike.${pattern}`)
        .order('nom', { ascending: true })
        .limit(LIMIT),
      admin
        .from('acps')
        .select('id, nom, adresse, ville, syndic_id_ref')
        .or(`nom.ilike.${pattern},adresse.ilike.${pattern},ville.ilike.${pattern}`)
        .order('nom', { ascending: true })
        .limit(LIMIT),
      admin
        .from('organisations')
        .select('id, nom, type, email')
        .or(`nom.ilike.${pattern},email.ilike.${pattern}`)
        .order('nom', { ascending: true })
        .limit(LIMIT),
    ]);

    const firstError = ivRes.error ?? occRes.error ?? cliRes.error ?? acpRes.error ?? orgRes.error;
    if (firstError) {
      console.error('[api/admin/search] query failed:', firstError.message);
      return NextResponse.json({ error: 'Recherche indisponible.' }, { status: 500 });
    }

    // Réf. de l'intervention liée pour chaque occupant (seconde requête in()
    // — pas d'embed PostgREST pour rester indépendant du nom de la FK).
    const occupants = (occRes.data ?? []) as Omit<SearchResults['occupants'][number], 'intervention_ref'>[];
    const refById = new Map<string, string | null>();
    const ivIds = Array.from(new Set(occupants.map((o) => o.intervention_id).filter(Boolean)));
    if (ivIds.length > 0) {
      const { data: refRows, error: refError } = await admin
        .from('interventions')
        .select('id, ref')
        .in('id', ivIds);
      if (refError) {
        console.error('[api/admin/search] refs occupants:', refError.message);
      } else {
        for (const r of (refRows ?? []) as { id: string; ref: string | null }[]) {
          refById.set(r.id, r.ref);
        }
      }
    }

    const results: SearchResults = {
      interventions: (ivRes.data ?? []) as SearchResults['interventions'],
      occupants: occupants.map((o) => ({ ...o, intervention_ref: refById.get(o.intervention_id) ?? null })),
      clients: (cliRes.data ?? []) as SearchResults['clients'],
      acps: (acpRes.data ?? []) as SearchResults['acps'],
      organisations: (orgRes.data ?? []) as SearchResults['organisations'],
    };
    return NextResponse.json({ results });
  } catch (e) {
    console.error('[api/admin/search] unexpected:', e);
    return NextResponse.json({ error: 'Recherche indisponible.' }, { status: 500 });
  }
}
