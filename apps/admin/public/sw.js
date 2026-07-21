// Smart Teams service worker.
//
// Caching rules:
// - /api/* : NEVER cached. Attendance, auth, and policy data must always be
//   live — serving a stale cached response here would be actively wrong
//   (e.g. showing an old KYC status or stale tenant policy).
// - Navigations (the HTML document — every full page load / route entry,
//   including client-side-routed paths like /tenant/leave): NETWORK-FIRST.
//   The previous version treated these like any other static asset
//   (stale-while-revalidate, cached per exact pathname) — which meant that
//   once a page was cached, the browser would keep serving that exact old
//   HTML/bundle-reference forever on repeat visits, even after a new
//   deploy shipped a bugfix, because "serve cached instantly" always wins
//   the race against the background revalidation. A user could be stuck
//   reliving an already-fixed bug indefinitely, surviving even a hard
//   refresh (the SW still intercepts and answers from cache before the
//   browser's own HTTP cache logic is consulted). Network-first means the
//   current deploy is always what renders; the cache is only a fallback
//   for genuine offline use.
// - /models/* : cache-first. The face-api.js model weights are ~10MB and
//   never change between deploys of the same version, so caching them
//   avoids re-downloading them on every visit — this matters a lot on
//   mobile connections.
// - Everything else (hashed JS/CSS bundles, icons, manifest): stale-while-
//   revalidate. Safe here because Vite's build output filenames are
//   content-hashed — a changed file is a new URL, never a stale hit under
//   an old one — so repeat loads are instant but still self-heal.
//
// VERSION bump: no longer required for every deploy (network-first
// navigation makes that unnecessary — see above), only when this file's
// caching STRATEGY itself changes, to force old installs to drop any
// caches keyed under the previous logic.

const VERSION = 'v2';
const STATIC_CACHE = `smart-teams-static-${VERSION}`;
const MODEL_CACHE = `smart-teams-models-${VERSION}`;

const APP_SHELL = [
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

// Web Push — the payload is whatever services/push.ts's sendPushToUser sent
// (JSON: { title, body, url }), same content as the in-app notification it
// always accompanies. `url` (defaults to the app root) is where a click on
// the notification navigates, reusing an already-open tab if there is one
// instead of always opening a new one.
self.addEventListener('push', (event) => {
  let data = { title: 'Smart Teams', body: 'You have a new notification.', url: '/' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if (client.url.includes(targetUrl) && 'focus' in client) return client.focus();
      }
      if (clientsList.length > 0 && 'focus' in clientsList[0]) {
        clientsList[0].navigate(targetUrl);
        return clientsList[0].focus();
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // never touch POST/PUT/DELETE (attendance, breaks, auth, etc.)

  const url = new URL(request.url);

  // Never cache API calls.
  if (url.pathname.startsWith('/api/')) {
    return; // let the browser handle it normally, straight to the network
  }

  // Network-first for navigations (full page loads and client-side route
  // entries) — always render the current deploy; cache is offline-only
  // fallback. `mode === 'navigate'` covers normal browser navigations;
  // `destination === 'document'` catches the rest (e.g. some PWA launch
  // paths that don't set mode).
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => caches.open(STATIC_CACHE).then((cache) => cache.match(request)))
    );
    return;
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

  // Stale-while-revalidate for everything else (hashed JS/CSS bundles,
  // icons, manifest).
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
