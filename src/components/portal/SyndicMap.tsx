'use client';

import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

type MapPin = {
  id: string;
  lat: number;
  lng: number;
  ref: string | null;
  acp_nom: string;
  statut: string;
  type: string | null;
};

// Marqueurs Leaflet — palette FoxO sémantique. Leaflet ne lit pas les
// CSS vars (canvas SVG), donc on duplique les valeurs des tokens ici.
// Garder synchronisé avec :root dans globals.css.
const FOXO_NAVY        = '#1b3a6b'; // var(--color-navy)
const FOXO_TERRA       = '#c4622d'; // var(--color-terra)
const FOXO_OK          = '#1f6b45'; // var(--color-ok)
const FOXO_AMBER       = '#b8830a'; // var(--color-amber-foxo)
const FOXO_INK_MUTED   = '#a09a8e'; // var(--color-ink-muted)
const FOXO_CREAM       = '#fdfbf7'; // var(--color-cream)
const FOXO_INK         = '#1c1a16'; // var(--color-ink)
const FOXO_INK_MID     = '#6b6558'; // var(--color-ink-mid)

const COLOR_BY_STATUT: Record<string, string> = {
  nouvelle:  FOXO_AMBER,    // en attente d'action
  confirmee: FOXO_NAVY,     // confirmé / planifié
  realisee:  FOXO_NAVY,
  attente:   FOXO_NAVY,
  rapport:   FOXO_OK,       // rapport prêt = validé
  cloturee:  FOXO_INK_MUTED,
};

function getColor(statut: string, priorite?: string): string {
  if (priorite === 'urgente') return FOXO_TERRA;
  return COLOR_BY_STATUT[statut] ?? FOXO_NAVY;
}

export default function SyndicMap({
  pins,
  basePath = '/portal/interventions',
}: {
  pins: MapPin[];
  basePath?: string;
}) {
  if (pins.length === 0) return null;

  // Centre sur le centroïde des pins
  const lat = pins.reduce((s, p) => s + p.lat, 0) / pins.length;
  const lng = pins.reduce((s, p) => s + p.lng, 0) / pins.length;

  return (
    <MapContainer
      center={[lat, lng]}
      zoom={13}
      style={{ height: '320px', width: '100%', borderRadius: 10, zIndex: 0 }}
      scrollWheelZoom={false}
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://carto.com/">CARTO</a>'
      />
      {pins.map((pin) => (
        <CircleMarker
          key={pin.id}
          center={[pin.lat, pin.lng]}
          radius={10}
          pathOptions={{
            fillColor: getColor(pin.statut),
            color: FOXO_CREAM,
            weight: 2,
            fillOpacity: 0.9,
          }}
        >
          <Popup>
            <div style={{ minWidth: 160 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: FOXO_INK }}>
                {pin.acp_nom}
              </div>
              {pin.ref && (
                <div style={{ fontSize: 11, color: FOXO_NAVY, fontFamily: 'monospace', fontWeight: 600 }}>
                  {pin.ref}
                </div>
              )}
              {pin.type && (
                <div style={{ fontSize: 11, color: FOXO_INK_MID, marginTop: 2 }}>
                  {pin.type}
                </div>
              )}
              <div style={{ marginTop: 6 }}>
                <a
                  href={`${basePath}/${pin.id}`}
                  style={{ fontSize: 11, color: FOXO_NAVY, textDecoration: 'underline', fontWeight: 500 }}
                >
                  Voir le dossier →
                </a>
              </div>
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
