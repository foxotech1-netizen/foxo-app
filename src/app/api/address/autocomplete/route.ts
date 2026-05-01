import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
// Edge serait possible mais on reste node pour cohérence avec les autres
// routes admin et pour respecter le quota Nominatim (1 req/s) sans
// risque de pic horizontal.
export const runtime = 'nodejs';

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
  address: {
    road?: string;
    pedestrian?: string;
    house_number?: string;
    postcode?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    suburb?: string;
    country?: string;
    country_code?: string;
  };
}

export interface AddressSuggestion {
  display_name: string;
  rue: string;
  numero: string;
  code_postal: string;
  ville: string;
  pays: string;
  lat: string;
  lng: string;
}

// Autocomplete d'adresse via Nominatim (OpenStreetMap).
// - Gratuit, sans clé API
// - Politique d'utilisation : User-Agent identifiable obligatoire,
//   max 1 requête/seconde côté serveur (le client a un debounce 400ms)
// - Documentation : https://nominatim.org/release-docs/latest/api/Search/
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') ?? '').trim();
  if (q.length < 4) {
    return NextResponse.json({ ok: true, suggestions: [] });
  }

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', q);
  url.searchParams.set('countrycodes', 'be');
  url.searchParams.set('format', 'json');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '5');
  url.searchParams.set('accept-language', 'fr');

  try {
    const res = await fetch(url.toString(), {
      headers: {
        // User-Agent identifiable (politique Nominatim)
        'User-Agent': 'FoxO/1.0 (info@foxo.be)',
        Accept: 'application/json',
      },
      // Cache 1h côté serveur — Nominatim apprécie qu'on ne tape pas
      // pour des requêtes identiques rapprochées.
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `Nominatim ${res.status}: ${res.statusText}` },
        { status: 502 },
      );
    }
    const raw = (await res.json()) as NominatimResult[];
    const suggestions: AddressSuggestion[] = (Array.isArray(raw) ? raw : []).map((r) => {
      const a = r.address ?? {};
      const rue = a.road ?? a.pedestrian ?? '';
      const ville = a.city ?? a.town ?? a.village ?? a.municipality ?? a.suburb ?? '';
      return {
        display_name: r.display_name,
        rue,
        numero: a.house_number ?? '',
        code_postal: a.postcode ?? '',
        ville,
        pays: a.country ?? 'Belgique',
        lat: r.lat,
        lng: r.lon,
      };
    });
    return NextResponse.json({ ok: true, suggestions });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Erreur réseau Nominatim.' },
      { status: 502 },
    );
  }
}
