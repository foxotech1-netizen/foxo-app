// Géocodage autonome via Nominatim (OpenStreetMap).
//
// Réutilise EXACTEMENT les mêmes paramètres d'appel que la route
// d'autocomplete d'adresse (src/app/api/address/autocomplete/route.ts) :
//   - même endpoint /search
//   - countrycodes=be + viewbox/bounded sur la bounding box Belgique
//   - User-Agent identifiable (politique Nominatim — sans ça : 403)
//   - cache: no-store
//
// Différence : on ne renvoie que la première paire lat/lng (number), ou
// null si aucun résultat / erreur. Ne jette jamais — try/catch → null.
// Aucune dépendance npm nouvelle.

export interface GeocodeResult {
  lat: number;
  lng: number;
}

interface NominatimResult {
  lat: string;
  lon: string;
}

export async function geocodeAddress(adresse: string): Promise<GeocodeResult | null> {
  const q = (adresse ?? '').trim();
  if (q.length < 4) return null;

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', q);
  url.searchParams.set('countrycodes', 'be');
  // viewbox = "lon_min,lat_min,lon_max,lat_max" (Belgique) + bounded=1 pour
  // restreindre dur les résultats à cette zone.
  url.searchParams.set('viewbox', '2.5,49.5,6.4,51.5');
  url.searchParams.set('bounded', '1');
  url.searchParams.set('format', 'json');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '5');
  url.searchParams.set('accept-language', 'fr');

  try {
    const res = await fetch(url.toString(), {
      headers: {
        // User-Agent identifiable (politique Nominatim — sans ça, 403)
        'User-Agent': 'FoxO/1.0 (info@foxo.be)',
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
    if (!res.ok) return null;

    const raw = (await res.json()) as NominatimResult[];
    const first = Array.isArray(raw) ? raw[0] : null;
    if (!first) return null;

    const lat = Number(first.lat);
    const lng = Number(first.lon);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return null;

    return { lat, lng };
  } catch {
    return null;
  }
}
