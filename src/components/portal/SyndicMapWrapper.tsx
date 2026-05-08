'use client';

import dynamic from 'next/dynamic';

const SyndicMap = dynamic(() => import('./SyndicMap'), { ssr: false });

type MapPin = {
  id: string;
  lat: number;
  lng: number;
  ref: string | null;
  acp_nom: string;
  statut: string;
  type: string | null;
};

export function SyndicMapWrapper({ pins }: { pins: MapPin[] }) {
  return <SyndicMap pins={pins} />;
}
