// Service worker FoxO Tech — version simple : cache de l'app shell + page offline.
// Le vrai mode hors-ligne (file d'attente de mutations, IndexedDB) est une
// phase 2. Ici on assure juste : assets statiques cachés + fallback offline.

const CACHE = 'foxo-tech-v1';
const SHELL = [
  '/offline.html',
  '/foxo-logo-transparent.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Navigations : network-first, fallback offline.html
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/offline.html')),
    );
    return;
  }

  // 2. Assets statiques same-origin : cache-first puis network
  if (
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/_next/static/') ||
      url.pathname === '/foxo-logo-transparent.png' ||
      url.pathname === '/manifest.webmanifest')
  ) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((resp) => {
            const clone = resp.clone();
            caches.open(CACHE).then((c) => c.put(event.request, clone));
            return resp;
          }),
      ),
    );
    return;
  }

  // 3. Tout le reste (API, auth, Supabase) : laisse passer sans interception.
  // Volontaire : on ne veut pas servir des données de session périmées.
});
