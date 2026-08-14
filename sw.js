/**
 * Service worker: cache-first for the app shell.
 *
 * This app is fully offline by nature — it computes points from taps and stores
 * everything in localStorage. Offline is the NORMAL condition at a pub table
 * with bad wifi, so the network is treated as the exception, not the default.
 *
 * Bump CACHE when any shipped file changes; activation drops older caches.
 */

const CACHE = 'rodret-v1';

const SHELL = [
  '.',
  'index.html',
  'manifest.webmanifest',
  'css/theme.css',
  'css/helm.css',
  'css/screens.css',
  'js/app.js',
  'js/rules.js',
  'js/state.js',
  'js/personas.js',
  'js/i18n.js',
  'js/storage.js',
  'js/ui/rail.js',
  'js/ui/pad.js',
  'js/ui/tally.js',
  'js/ui/screens.js',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll is atomic: one missing file would leave no cache at all, so add
      // them individually and let a single failure degrade rather than break.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request)
        .then((response) => {
          // Only cache our own successful responses.
          if (response.ok && new URL(request.url).origin === self.location.origin) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          // A navigation that misses the cache still gets the shell, so a cold
          // offline launch opens the app rather than Safari's error page.
          request.mode === 'navigate' ? caches.match('index.html') : Response.error()
        );
    })
  );
});
