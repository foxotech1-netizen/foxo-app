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
    console.error('[nominatim] short query, no fetch', { q, len: q.length });
    return NextResponse.json({ ok: true, suggestions: [] });
  }

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', q);
  url.searchParams.set('countrycodes', 'be');
  // Bounded + viewbox = restreint dur les résultats à la bounding box
  // Belgique (lon 2.5→6.4°E, lat 49.5→51.5°N). Sans `bounded=1`, le
  // viewbox n'est qu'une préférence et Nominatim peut renvoyer hors-zone.
  // Format viewbox : "x1,y1,x2,y2" = "lon_min,lat_min,lon_max,lat_max".
  url.searchParams.set('viewbox', '2.5,49.5,6.4,51.5');
  url.searchParams.set('bounded', '1');
  url.searchParams.set('format', 'json');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '5');
  url.searchParams.set('accept-language', 'fr');

  console.error('[nominatim] url:', url.toString());

  try {
    const res = await fetch(url.toString(), {
      headers: {
        // User-Agent identifiable (politique Nominatim — sans ça, 403)
        'User-Agent': 'FoxO/1.0 (info@foxo.be)',
        Accept: 'application/json',
      },
      // Pas de next.revalidate ici — la route est en force-dynamic donc
      // la combinaison crée des warnings sans bénéfice. Nominatim côté
      // serveur reste largement sous le rate-limit (debounce client 400ms).
      cache: 'no-store',
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.error('[nominatim] HTTP error', { status: res.status, statusText: res.statusText, body_preview: txt.slice(0, 200) });
      return NextResponse.json(
        { ok: false, error: `Nominatim ${res.status}: ${res.statusText}`, body_preview: txt.slice(0, 200) },
        { status: 502 },
      );
    }
    const raw = (await res.json()) as NominatimResult[];
    console.error('[nominatim] results:', Array.isArray(raw) ? raw.length : 'not-array');
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
    console.error('[nominatim] threw', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Erreur réseau Nominatim.' },
      { status: 502 },
    );
  }
}
