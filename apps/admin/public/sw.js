// Smart Teams service worker.
//
// Caching rules, deliberately conservative:
// - /api/* : NEVER cached. Attendance, auth, and policy data must always be
//   live — serving a stale cached response here would be actively wrong
//   (e.g. showing an old KYC status or stale tenant policy).
// - /models/* : cache-first. The face-api.js model weights are ~10MB and
//   never change between deploys of the same version, so caching them
//   avoids re-downloading them on every visit — this matters a lot on
//   mobile connections.
// - Everything else (app shell, JS/CSS bundles, icons): stale-while-
//   revalidate, so repeat loads are instant but still self-heal after a
//   new deploy.

const VERSION = 'v1';
const STATIC_CACHE = `smart-teams-static-${VERSION}`;
const MODEL_CACHE = `smart-teams-models-${VERSION}`;

const APP_SHELL = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== MODEL_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // never touch POST/PUT/DELETE (attendance, breaks, auth, etc.)

  const url = new URL(request.url);

  // Never cache API calls.
  if (url.pathname.startsWith('/api/')) {
    return; // let the browser handle it normally, straight to the network
  }

  // Cache-first for the ML model weights.
  if (url.pathname.startsWith('/models/')) {
    event.respondWith(
      caches.open(MODEL_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
    );
    return;
  }

  // Stale-while-revalidate for everything else (app shell, JS/CSS, icons).
  event.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
