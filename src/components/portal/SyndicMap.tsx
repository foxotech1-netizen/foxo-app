'use client';

import { useEffect } from 'react';
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

const COLOR_BY_STATUT: Record<string, string> = {
  nouvelle: '#FBBF24',
  confirmee: '#60A5FA',
  realisee: '#60A5FA',
  attente: '#60A5FA',
  rapport: '#34D399',
  urgente: '#F87171',
  cloturee: '#9CA3AF',
};

function getColor(statut: string, priorite?: string): string {
  if (priorite === 'urgente') return '#F87171';
  return COLOR_BY_STATUT[statut] ?? '#60A5FA';
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
      style={{ height: '320px', width: '100%', borderRadius: '12px', zIndex: 0 }}
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
            color: '#fff',
            weight: 2,
            fillOpacity: 0.9,
          }}
        >
          <Popup>
            <div style={{ minWidth: 160 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#1B3A5C' }}>
                {pin.acp_nom}
              </div>
              {pin.ref && (
                <div style={{ fontSize: 11, color: '#60A5FA', fontFamily: 'monospace' }}>
                  {pin.ref}
                </div>
              )}
              {pin.type && (
                <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
                  {pin.type}
                </div>
              )}
              <div style={{ marginTop: 6 }}>
                <a
                  href={`${basePath}/${pin.id}`}
                  style={{ fontSize: 11, color: '#60A5FA', textDecoration: 'underline' }}
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
