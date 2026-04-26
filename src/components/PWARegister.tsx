'use client';

import { useEffect } from 'react';

// Enregistre le service worker uniquement côté client. À monter dans le layout
// /tech pour scoper la PWA à cette section. Le navigateur prendra le manifest
// référencé via les metadata Next + /manifest.webmanifest.
export function PWARegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return; // pas de SW en dev

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((err) => console.warn('[pwa] sw register failed', err));
  }, []);
  return null;
}
